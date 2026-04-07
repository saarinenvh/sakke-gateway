import type { FastifyInstance } from "fastify";
import { getMorningGreeting, getPendingReminder } from "../services/reminders.js";

export async function reminderRoutes(app: FastifyInstance): Promise<void> {
  app.get("/reminders/morning", async (_request, reply) => {
    const text = await getMorningGreeting();
    return reply.send({ text });
  });

  app.get("/reminders/check", async (_request, reply) => {
    const text = await getPendingReminder();
    if (!text) return reply.send({ text: null, skip: true });
    return reply.send({ text, skip: false });
  });
}
