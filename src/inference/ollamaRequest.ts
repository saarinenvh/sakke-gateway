import type { OllamaTargetConfig } from "../config.js";
import type { OllamaChatRequest } from "../integrations/ollama/client.js";
import type { Message } from "../integrations/ollama/types.js";
import type { ToolDefinition } from "../tools/types.js";

// Room left in the context for the reply. Also the reply's length limit, so
// the conversation trimmer and num_predict can't disagree.
export const RESPONSE_RESERVE_TOKENS = 2000;

const SAKKE_TEMPERATURE = 0.7;

// The one way Sakke's own model calls are shaped, for a conversation turn and
// for a caller's piece of text alike. No tools sends no schema at all, which
// is what makes the model answer in prose.
export function buildSakkeRequest(messages: Message[], target: OllamaTargetConfig, tools: ToolDefinition[]): OllamaChatRequest {
  return {
    model: target.model,
    messages,
    ...(tools.length > 0 && { tools }),
    ...(target.think !== undefined && { think: target.think }),
    ...(target.keepAlive !== undefined && { keep_alive: target.keepAlive }),
    options: { temperature: SAKKE_TEMPERATURE, num_predict: RESPONSE_RESERVE_TOKENS, num_ctx: target.numCtx },
  };
}
