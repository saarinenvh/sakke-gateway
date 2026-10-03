import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { chatCompletionResponseExample, chatCompletionResponseSchema } from "./schema.js";

describe("OpenAI boundary schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(chatCompletionResponseSchema, chatCompletionResponseExample, "OpenAI chat completion example")).not.toThrow();
  });
});
