import "dotenv/config";
import Fastify from "fastify";
import { sceneRoutes } from "./routes/scene.js";
import { conversationRoutes } from "./routes/conversation.js";
import { reminderRoutes } from "./routes/reminders.js";
import { displayRoutes } from "./routes/display.js";
import { loadEntities } from "./services/ha/registry.js";

const port = parseInt(process.env.PORT ?? "3100", 10);

const app = Fastify({ logger: true });

app.register(sceneRoutes);
app.register(conversationRoutes);
app.register(reminderRoutes);
app.register(displayRoutes);

app.get("/health", async () => ({ ok: true }));

loadEntities()
  .then(() => {
    app.log.info("HA entities loaded");
    app.listen({ port, host: "0.0.0.0" }, (err) => {
      if (err) {
        app.log.error(err);
        process.exit(1);
      }
    });
  })
  .catch((err) => {
    app.log.error({ err }, "Failed to load HA entities, starting anyway");
    app.listen({ port, host: "0.0.0.0" }, (err) => {
      if (err) {
        app.log.error(err);
        process.exit(1);
      }
    });
  });
