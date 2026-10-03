import { describe, it } from "vitest";
import { parseOrThrow } from "../util/validation.js";
import {
  chatCompletionRequestExample,
  chatCompletionRequestSchema,
  chatCompletionResponseExample,
  chatCompletionResponseSchema,
} from "./schema.js";

describe("agent boundary schemas", () => {
  it("accept their examples", () => {
    parseOrThrow(chatCompletionRequestSchema, chatCompletionRequestExample, "chat completion request example");
    parseOrThrow(chatCompletionResponseSchema, chatCompletionResponseExample, "chat completion response example");
  });
});
