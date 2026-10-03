import { describe, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { coffeeArgsExample, coffeeArgsSchema } from "./schema.js";

describe("coffee schemas", () => {
  it("accept their examples", () => {
    parseOrThrow(coffeeArgsSchema, coffeeArgsExample, "coffee args example");
  });
});
