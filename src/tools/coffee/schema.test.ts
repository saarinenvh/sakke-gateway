import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { coffeeArgsExample, coffeeArgsSchema } from "./schema.js";

describe("coffee schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(coffeeArgsSchema, coffeeArgsExample, "coffee args example")).not.toThrow();
  });
});
