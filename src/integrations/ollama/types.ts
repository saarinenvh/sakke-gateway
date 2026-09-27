// `id` and `type` are OpenAI-shaped conventions Ollama doesn't always send -
// older versions omit both entirely. `function.index` is what Ollama itself
// uses to correlate a parallel tool call back to its result; nothing here
// reads it today, but it's real wire data, not safe to assume absent.
export interface OllamaToolCall {
  id?: string;
  type?: "function";
  function: {
    name: string;
    arguments: Record<string, unknown>;
    index?: number;
  };
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: OllamaToolCall[];
}
