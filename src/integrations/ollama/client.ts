import type { Message } from "./types.js";
import type { ToolDefinition } from "../../tools/types.js";
import { chatResponseSchema } from "./schemas.js";

// Mirrors homeAssistant/client.ts and openai/client.ts: one place for the
// request/response/error handling that agent.ts and continuationCheck.ts
// otherwise each built their own copy of, against the same endpoint.

// Two genuinely different failure modes: the request reached Ollama and got
// a bad HTTP status, or it got a 200 with a body that doesn't match the
// response contract. Callers need to tell these apart (see continuationCheck.ts),
// so `kind` is real, not a status of 0 standing in for "not HTTP".
export class OllamaError extends Error {
  private constructor(
    message: string,
    readonly kind: "http" | "invalid_response",
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "OllamaError";
  }

  static http(status: number, body: string): OllamaError {
    return new OllamaError(`Ollama HTTP ${status}${body ? `: ${body.slice(0, 500)}` : ""}`, "http", status, body);
  }

  static invalidResponse(issues: string): OllamaError {
    return new OllamaError(`Ollama response failed validation: ${issues}`, "invalid_response");
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

  if (!res.ok) throw OllamaError.http(res.status, await res.text().catch(() => ""));

  const parsed = chatResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw OllamaError.invalidResponse(parsed.error.message);

  return parsed.data.message;
}
