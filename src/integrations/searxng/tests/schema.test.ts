import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../../util/validation.js";
import { searchResponseExample, searchResponseSchema } from "../schema.js";

describe("SearXNG boundary schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(searchResponseSchema, searchResponseExample, "SearXNG search example")).not.toThrow();
  });
});
