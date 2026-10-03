import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { chatResponseExample, chatResponseSchema } from "./schema.js";

describe("Ollama boundary schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(chatResponseSchema, chatResponseExample, "Ollama chat response example")).not.toThrow();
  });
});
