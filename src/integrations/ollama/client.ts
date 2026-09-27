import type { Message } from "./types.js";
import type { ToolDefinition } from "../../tools/types.js";
import { parseJsonResponse } from "../../util/validation.js";
import { chatResponseSchema } from "./schemas.js";

// Mirrors homeAssistant/client.ts and openai/client.ts: one place for the
// request/response/error handling that agent.ts and continuationCheck.ts
// otherwise each built their own copy of, against the same endpoint.

// The request reached Ollama and got a bad HTTP status. A 2xx whose body
// isn't valid JSON or doesn't match the response contract is a different
// failure - a ValidationError, as with every other integration - and callers
// that need to tell them apart (continuationCheck.ts) check the class.
export class OllamaError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Ollama HTTP ${status}${body ? `: ${body.slice(0, 500)}` : ""}`);
    this.name = "OllamaError";
  }
}

export interface OllamaChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  think?: boolean;
  keep_alive?: string;
  options: {
    temperature?: number;
    num_predict?: number;
    num_ctx?: number;
  };
}

export async function ollamaChat(baseUrl: string, request: OllamaChatRequest): Promise<Message> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, stream: false }),
  });

  if (!res.ok) throw new OllamaError(res.status, await res.text().catch(() => ""));

  const response = await parseJsonResponse(res, chatResponseSchema, `Ollama POST ${baseUrl}/api/chat`);
  return response.message;
}
