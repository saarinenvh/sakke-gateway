import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../../util/validation.js";
import { createKnowledgeArgsExample, createKnowledgeArgsSchema, getContextArgsExample, getContextArgsSchema } from "../schema.js";

describe("wiki schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(getContextArgsSchema, getContextArgsExample, "get_context args example")).not.toThrow();
    expect(() => parseOrThrow(createKnowledgeArgsSchema, createKnowledgeArgsExample, "create_knowledge args example")).not.toThrow();
  });
});
