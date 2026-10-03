import { config } from "../../config.js";
import { parseJsonResponse } from "../../util/validation.js";
import { chatCompletionResponseSchema } from "./schema.js";

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
  temperature?: number;
  timeoutMs?: number;
}

// The body of POST /v1/chat/completions.
interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
}

export async function chatCompletion(
  model: string,
  messages: ChatMessage[],
  { temperature, timeoutMs = DEFAULT_TIMEOUT_MS }: ChatCompletionOptions = {},
): Promise<string> {
  const path = "/v1/chat/completions";
  // o-series reasoning models (o1, o3, ...) reject the request outright if
  // temperature is present at all - not just a default, the key must be missing.
  const isReasoningModel = model.startsWith("o");
  const body: ChatCompletionRequest = {
    model,
    messages,
    ...(temperature !== undefined && !isReasoningModel && { temperature }),
  };
  const res = await fetch(`https://api.openai.com${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openai.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new OpenAiError(res.status, await res.text().catch(() => ""), path);

  const response = await parseJsonResponse(res, chatCompletionResponseSchema, `OpenAI POST ${path}`);
  return response.choices[0].message.content?.trim() ?? "";
}
