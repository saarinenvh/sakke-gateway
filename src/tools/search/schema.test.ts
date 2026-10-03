import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { searchResponseExample, searchResponseSchema, webSearchArgsExample, webSearchArgsSchema } from "./schema.js";

describe("web_search schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(webSearchArgsSchema, webSearchArgsExample, "web_search args example")).not.toThrow();
    expect(() => parseOrThrow(searchResponseSchema, searchResponseExample, "SearXNG search example")).not.toThrow();
  });
});
