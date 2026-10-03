import { describe, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { searchResponseExample, searchResponseSchema, webSearchArgsExample, webSearchArgsSchema } from "./schema.js";

describe("web_search schemas", () => {
  it("accept their examples", () => {
    parseOrThrow(webSearchArgsSchema, webSearchArgsExample, "web_search args example");
    parseOrThrow(searchResponseSchema, searchResponseExample, "SearXNG search example");
  });
});
