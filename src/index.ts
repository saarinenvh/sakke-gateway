import "dotenv/config";
import Fastify from "fastify";
import { sceneRoutes } from "./routes/scene.js";
import { conversationRoutes } from "./routes/conversation.js";
import { reminderRoutes } from "./routes/reminders.js";
import { displayRoutes } from "./routes/display.js";
import { gpuStatusRoutes } from "./routes/gpuStatus.js";
import { loadEntities } from "./services/ha/registry.js";
import { setModuleLogger } from "./services/logger.js";
import { restoreTimers } from "./services/timers.js";

const port = parseInt(process.env.PORT ?? "3100", 10);

const SILENT_ROUTES = new Set(["/health", "/reminders/check", "/display/events", "/internal/gpu-status"]);

const app = Fastify({
  logger: {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname,reqId",
      },
    },
  },
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

// Modules without a request logger (scenes.ts, spotify.ts) log through this.
setModuleLogger(app.log);

function listen(): void {
  app.listen({ port, host: "0.0.0.0" }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}

// Starts either way - a dead HA at boot shouldn't stop the gateway coming up,
// and refresh_home_data can reload the registry once it's back.
void restoreTimers();

loadEntities()
  .then(() => app.log.info("HA entities loaded"))
  .catch((err) => app.log.error({ err }, "Failed to load HA entities, starting anyway"))
  .finally(listen);
