import { describe, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { createKnowledgeArgsExample, createKnowledgeArgsSchema, getContextArgsExample, getContextArgsSchema } from "./schema.js";

describe("wiki schemas", () => {
  it("accept their examples", () => {
    parseOrThrow(getContextArgsSchema, getContextArgsExample, "get_context args example");
    parseOrThrow(createKnowledgeArgsSchema, createKnowledgeArgsExample, "create_knowledge args example");
  });
});
