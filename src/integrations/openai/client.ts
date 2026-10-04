import { config } from "../../config.js";
import { parseJsonResponse } from "../../util/validation.js";
import { chatCompletionResponseSchema, type ReasoningEffort } from "./schema.js";

// One OpenAI client, mirroring homeAssistant/client.ts's shape: a single place
// for auth headers, timeout and error handling instead of each caller building
// its own fetch. Only scene design calls OpenAI today - this exists so the
// next caller doesn't repeat that fetch from scratch.

const DEFAULT_TIMEOUT_MS = 30_000;

export class OpenAiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly path: string,
  ) {
    super(`OpenAI ${status} on ${path}${body ? `: ${body.slice(0, 500)}` : ""}`);
    this.name = "OpenAiError";
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  // Ignored for reasoning models, which reject it.
  temperature?: number;
  // Only sent to reasoning models; the others reject it.
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
}

// The body of POST /v1/chat/completions.
interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  reasoning_effort?: ReasoningEffort;
}

export async function chatCompletion(
  model: string,
  messages: ChatMessage[],
  { temperature, reasoningEffort, timeoutMs = DEFAULT_TIMEOUT_MS }: ChatCompletionOptions = {},
): Promise<string> {
  const path = "/v1/chat/completions";
  const body = buildRequestBody(model, messages, { temperature, reasoningEffort });
  const res = await fetch(`https://api.openai.com${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openai.publicApiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new OpenAiError(res.status, await res.text().catch(() => ""), path);

  const response = await parseJsonResponse(res, chatCompletionResponseSchema, `OpenAI POST ${path}`);
  return response.choices[0].message.content?.trim() ?? "";
}

// Reasoning models (the o-series and gpt-5 family) reject a request that
// carries temperature at all - not just a non-default value, the key must be
// missing. Older chat models reject reasoning_effort the same way.
function buildRequestBody(
  model: string,
  messages: ChatMessage[],
  { temperature, reasoningEffort }: Pick<ChatCompletionOptions, "temperature" | "reasoningEffort">,
): ChatCompletionRequest {
  if (isReasoningModel(model)) {
    return { model, messages, ...(reasoningEffort !== undefined && { reasoning_effort: reasoningEffort }) };
  }
  return { model, messages, ...(temperature !== undefined && { temperature }) };
}

function isReasoningModel(model: string): boolean {
  return /^o\d/.test(model) || model.startsWith("gpt-5");
}
