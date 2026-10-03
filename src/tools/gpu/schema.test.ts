import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { setGamingModeArgsExample, setGamingModeArgsSchema } from "./schema.js";

describe("set_gaming_mode schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(setGamingModeArgsSchema, setGamingModeArgsExample, "set_gaming_mode args example")).not.toThrow();
  });
});
