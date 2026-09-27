import { z } from "zod";
import type { Message, OllamaToolCall } from "./types.js";

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
