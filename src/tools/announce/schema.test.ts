import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { announceArgsExample, announceArgsSchema } from "./schema.js";

describe("announce schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(announceArgsSchema, announceArgsExample, "announce args example")).not.toThrow();
  });
});
