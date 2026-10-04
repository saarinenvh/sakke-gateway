import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../../util/validation.js";
import { stateChangeExample, stateChangeSchema } from "../schema.js";

describe("display boundary schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(stateChangeSchema, stateChangeExample, "display state change example")).not.toThrow();
  });
});
