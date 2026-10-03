import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import {
  chatCompletionRequestExample,
  chatCompletionRequestSchema,
  chatCompletionResponseExample,
  chatCompletionResponseSchema,
} from "../schema.js";

describe("agent boundary schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(chatCompletionRequestSchema, chatCompletionRequestExample, "chat completion request example")).not.toThrow();
    expect(() => parseOrThrow(chatCompletionResponseSchema, chatCompletionResponseExample, "chat completion response example")).not.toThrow();
  });
});
