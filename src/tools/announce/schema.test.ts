import { describe, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { announceArgsExample, announceArgsSchema } from "./schema.js";

describe("announce schemas", () => {
  it("accept their examples", () => {
    parseOrThrow(announceArgsSchema, announceArgsExample, "announce args example");
  });
});
