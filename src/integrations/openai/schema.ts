import { z } from "zod";

// gateway → OpenAI, the `reasoning_effort` of a request to a reasoning model.
// Read from the environment, so it is validated like any other boundary value.
export const reasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high"]);

export type ReasoningEffort = z.output<typeof reasoningEffortSchema>;

// OpenAI → gateway, the answer to POST /v1/chat/completions (openai/client.ts).

export const chatCompletionResponseExample = {
  id: "chatcmpl-Bx7kQ2mN4pR8sT1vW3yZ5aC6dE9f", // ignored
  object: "chat.completion", // ignored
  created: 1791013320, // ignored
  model: "gpt-4.1-2025-04-14", // ignored
  choices: [
    {
      index: 0, // ignored
      message: {
        role: "assistant", // ignored
        content: "A warm, dim evening scene.",
        refusal: null, // ignored
        annotations: [], // ignored
      },
      logprobs: null, // ignored
      finish_reason: "stop", // ignored
    },
  ],
  usage: {
    prompt_tokens: 412,
    completion_tokens: 87,
    total_tokens: 499,
    prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
    completion_tokens_details: {
      reasoning_tokens: 0,
      audio_tokens: 0,
      accepted_prediction_tokens: 0,
      rejected_prediction_tokens: 0,
    },
  }, // ignored
  service_tier: "default", // ignored
  system_fingerprint: "fp_3a7c9e1b5d", // ignored
};

// content is null when the model refuses or answers with tool calls instead.
export const chatCompletionResponseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .min(1),
});
