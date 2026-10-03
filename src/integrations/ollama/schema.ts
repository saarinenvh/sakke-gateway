import { z } from "zod";
import type { Message, OllamaToolCall } from "./types.js";

// Ollama → gateway, the answer to POST /api/chat with stream: false
// (ollama/client.ts). The request is OllamaChatRequest in client.ts.

export const chatResponseExample = {
  model: "qwen3:4b", // ignored
  created_at: "2026-10-03T07:42:00.123456789Z", // ignored
  message: {
    role: "assistant",
    content: "",
    thinking: "The user wants the living room light on.", // ignored: only sent when think is on
    tool_calls: [
      {
        id: "call_k3n8x2qp",
        function: {
          index: 0,
          name: "control_light",
          arguments: { entity_id: "light.living_room", action: "turn_on" },
        },
      },
    ],
  },
  done_reason: "stop", // ignored
  done: true, // ignored
  total_duration: 1843125700, // ignored
  load_duration: 41200500, // ignored
  prompt_eval_count: 1532, // ignored
  prompt_eval_duration: 612004300, // ignored
  eval_count: 38, // ignored
  eval_duration: 1180220900, // ignored
};

// `satisfies` keeps these schemas honest against the hand-written types in
// types.ts - a field added to Message without a matching schema update fails
// to compile, instead of silently under-validating.
const toolCallSchema = z.object({
  id: z.string().optional(),
  type: z.literal("function").optional(),
  function: z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
    index: z.number().optional(),
  }),
}) satisfies z.ZodType<OllamaToolCall>;

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(toolCallSchema).optional(),
}) satisfies z.ZodType<Message>;

export const chatResponseSchema = z.object({ message: messageSchema });
