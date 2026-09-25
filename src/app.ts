import Fastify, { type FastifyInstance } from "fastify";
import { sceneRoutes } from "./scenes/route.js";
import { conversationRoutes } from "./agent/route.js";
import { reminderRoutes } from "./reminders/route.js";
import { displayRoutes } from "./display/route.js";
import { gpuStatusRoutes } from "./gpu/route.js";

// Routes that would otherwise fill the log: the health check, the tasks poll
// wired to an HA automation, the display's SSE stream, and the PC's GPU
// heartbeat every 20 seconds.
const SILENT_ROUTES = new Set(["/health", "/reminders/check", "/display/events", "/internal/gpu-status"]);

export interface BuildAppOptions {
  /** Off in tests, where pino-pretty's worker thread is just noise. */
  logger?: boolean;
}

// Builds the HTTP surface and nothing else. index.ts owns the side effects -
// wiring the timer handler, reporting config problems, loading the entity
// registry, listening - so that tests can exercise the routes through
// app.inject() without starting a server or touching any of that.
export function buildApp({ logger = true }: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: logger
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname,reqId" },
          },
        }
      : false,
    disableRequestLogging: true,
    genReqId: () => Math.random().toString(36).slice(2, 6),
  });

  app.addHook("onResponse", async (request, reply) => {
    // request.url carries the query string, so "/display/events?foo=1" never
    // matched and logged on every reconnect.
    if (SILENT_ROUTES.has(request.url.split("?")[0])) return;
    app.log.info(`${request.method} ${request.url} ${reply.statusCode} (${Math.round(reply.elapsedTime)}ms)`);
  });

  app.register(sceneRoutes);
  app.register(conversationRoutes);
  app.register(reminderRoutes);
  app.register(displayRoutes);
  app.register(gpuStatusRoutes);

  app.get("/health", async () => ({ ok: true }));

  return app;
}
