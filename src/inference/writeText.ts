import type { FastifyBaseLogger } from "fastify";
import { ollamaChat } from "../integrations/ollama/client.js";
import type { Message } from "../integrations/ollama/types.js";
import { buildSakkeRequest } from "./ollamaRequest.js";
import { getOllamaTarget } from "./ollamaRouter.js";
import type { CallerProfileName } from "./profiles.js";
import { sakkeSystemPrompt } from "./systemPrompt.js";
import { cleanForSpeech } from "./voiceText.js";

// One piece of text in Sakke's voice, for a feature that owns what happens to
// it: no tools, no history, nothing on the display. Same prompt, model and
// options as a conversation turn, so the voice doesn't change with the caller.
export async function writeText(profile: CallerProfileName, request: string, log: FastifyBaseLogger): Promise<string> {
  const messages: Message[] = [
    { role: "system", content: await sakkeSystemPrompt() },
    { role: "user", content: request },
  ];
  const target = getOllamaTarget(log);

  log.info({ profile, request, model: target.model, baseUrl: target.baseUrl }, "Writing text");
  const reply = await ollamaChat(target.baseUrl, buildSakkeRequest(messages, target, []), log);
  const text = cleanForSpeech(reply.content, true);
  log.info({ profile, model: target.model, text }, "Text written");
  return text;
}
