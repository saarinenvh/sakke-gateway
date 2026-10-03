import type { FastifyInstance } from "fastify";
import { runAgent } from "./agent.js";
import { chatCompletionRequestSchema, type ChatCompletionResponse } from "./schema.js";

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/chat/completions", async (request, reply) => {
    const parsed = chatCompletionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "messages must be a list of { role, content } strings, and conversation_id and extra_system_prompt strings" });
    }
    const body = parsed.data;

    const last = [...body.messages].reverse().find((m) => m.role === "user");
    const text = last?.content.trim() ?? "";
    const conversationId = body.conversation_id ?? "default";

    let responseText: string;
    let continueConversation = true;

    if (!text) {
      responseText = "Didn't catch that.";
    } else {
      try {
        const extraSystemPrompt = body.extra_system_prompt?.trim() || undefined;
        const result = await runAgent(text, conversationId, request.log, { profile: "sakke", extraSystemPrompt });
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

    const response = {
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
    };
    return reply.send(response satisfies ChatCompletionResponse);
  });
}
