import type { FastifyInstance } from "fastify";
import { parseIntent } from "../services/ollama.js";
import { dispatch } from "../services/homeAssistant.js";

interface CommandBody {
  text: string;
}

export async function commandRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CommandBody }>("/command", {
    schema: {
      body: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string", minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { text } = request.body;

    const intent = await parseIntent(text);
    app.log.info({ intent }, "Parsed intent");

    const response = await dispatch(intent);

    return reply.send({ ok: true, intent, response });
  });
}
