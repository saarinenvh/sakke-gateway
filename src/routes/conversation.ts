import type { FastifyInstance } from "fastify";
import { runAgent } from "../services/agent.js";

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatCompletionBody {
  model?: string;
  messages: ChatMessage[];
  conversation_id?: string;
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
          conversation_id: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const messages = request.body.messages ?? [];
    const last = [...messages].reverse().find((m) => m.role === "user");
    const text = last?.content?.trim() ?? "";
    const conversationId = request.body.conversation_id ?? "default";

    let responseText: string;
    let continueConversation = true;

    if (!text) {
      responseText = "Didn't catch that.";
    } else {
      const result = await runAgent(text, conversationId, request.log);
      responseText = result.content;
      continueConversation = result.continueConversation;
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
      continue_conversation: continueConversation,
    });
  });
}
