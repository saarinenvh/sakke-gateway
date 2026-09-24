import type { FastifyInstance } from "fastify";
import { runAgent } from "./agent.js";

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
      try {
        const result = await runAgent(text, conversationId, request.log);
        responseText = result.content;
        continueConversation = result.continueConversation;
      } catch (err: any) {
        // Neither the Ollama fetch nor its !res.ok check in agent.ts are
        // wrapped in try/catch, so without this the real cause (a bad HTTP
        // status from Ollama, a network failure, anything) never got logged
        // anywhere - only a bare 500 reached the caller, spoken aloud
        // verbatim by the voice pipeline as "Gateway error 500". Log it for
        // real, and degrade to a spoken response instead of a raw HTTP error.
        request.log.error({ conversationId, err: err.message, stack: err.stack }, "runAgent failed");
        responseText = "Something broke on my end. Try that again.";
        continueConversation = false;
      }
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
