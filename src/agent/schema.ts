import { z } from "zod";

// sakke_agent (sakke-workspace custom_components/sakke_agent/agent.py) →
// gateway, POST /v1/chat/completions, and the gateway's response back.

export const chatCompletionRequestExample = {
  messages: [{ role: "user", content: "turn on the kitchen lights" }],
  conversation_id: "01J9Z3K7Q8X4M2N6P5R0T1V2W3",
  extra_system_prompt: "You just asked the owner whether to run the vacuum.", // only when HA forwards one
};

export const chatCompletionRequestSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
  conversation_id: z.string().optional(),
  extra_system_prompt: z.string().optional(),
});

export const chatCompletionResponseExample = {
  id: "sakke-1", // ignored
  object: "chat.completion", // ignored
  model: "sakke", // ignored
  choices: [
    {
      index: 0, // ignored
      message: {
        role: "assistant", // ignored
        content: "Kitchen lights on.",
      },
      finish_reason: "stop", // ignored
    },
  ],
  continue_conversation: true, // missing means true
};

export const chatCompletionResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  continue_conversation: z.boolean().optional(),
});

export type ChatCompletionResponse = z.input<typeof chatCompletionResponseSchema>;
