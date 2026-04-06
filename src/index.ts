import "dotenv/config";
import Fastify from "fastify";
import { commandRoutes } from "./routes/command.js";
import { sceneRoutes } from "./routes/scene.js";
import { conversationRoutes } from "./routes/conversation.js";
import { loadEntities } from "./services/entityRegistry.js";

const port = parseInt(process.env.PORT ?? "3100", 10);

const app = Fastify({ logger: true });

app.register(commandRoutes);
app.register(sceneRoutes);
app.register(conversationRoutes);

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
