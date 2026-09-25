import { config } from "../../config.js";

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

export interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
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
  const res = await fetch(`https://api.openai.com${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openai.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      ...(temperature !== undefined && !isReasoningModel && { temperature }),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new OpenAiError(res.status, await res.text().catch(() => ""), path);

  const json = await res.json() as ChatCompletionResponse;
  return json?.choices?.[0]?.message?.content?.trim() ?? "";
}
