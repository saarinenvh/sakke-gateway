import type { FastifyInstance } from "fastify";
import { parseIntent } from "../services/ollama.js";
import { dispatch } from "../services/homeAssistant.js";

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatCompletionBody {
  model?: string;
  messages: ChatMessage[];
}

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ChatCompletionBody }>("/v1/chat/completions", {
    schema: {
      body: {
        type: "object",
        required: ["messages"],
        properties: {
          model: { type: "string" },
          messages: { type: "array" },
        },
      },
    },
  }, async (request, reply) => {
    // Extract the last user message
    const messages = request.body.messages ?? [];
    const last = [...messages].reverse().find((m) => m.role === "user");
    const text = last?.content?.trim() ?? "";

    let responseText: string;

    if (!text) {
      responseText = "En kuullut mitään.";
    } else {
      const intent = await parseIntent(text);
      app.log.info({ intent }, "Parsed intent from voice");
      responseText = await dispatch(intent);
    }

    return reply.send({
      id: "sakke-1",
      object: "chat.completion",
      model: "sakke",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: responseText },
          finish_reason: "stop",
        },
      ],
    });
  });
}
