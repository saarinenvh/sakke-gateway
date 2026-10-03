import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../../util/validation.js";
import { webSearchArgsExample, webSearchArgsSchema } from "../schema.js";

describe("web_search schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(webSearchArgsSchema, webSearchArgsExample, "web_search args example")).not.toThrow();
  });
});
