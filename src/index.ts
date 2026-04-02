import "dotenv/config";
import Fastify from "fastify";
import { commandRoutes } from "./routes/command.js";

const port = parseInt(process.env.PORT ?? "3100", 10);

const app = Fastify({ logger: true });

app.register(commandRoutes);

app.get("/health", async () => ({ ok: true }));

app.listen({ port, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
