import type { FastifyInstance } from "fastify";
import { getPendingReminder } from "./reminders.js";

export async function reminderRoutes(app: FastifyInstance): Promise<void> {
  app.get("/reminders/check", async (_request, reply) => {
    const text = await getPendingReminder();
    if (!text) return reply.send({ text: null, skip: true });
    return reply.send({ text, skip: false });
  });
}
