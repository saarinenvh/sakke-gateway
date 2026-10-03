import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../../util/validation.js";
import { vacuumArgsExample, vacuumArgsSchema } from "../schema.js";

describe("vacuum schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(vacuumArgsSchema, vacuumArgsExample, "vacuum args example")).not.toThrow();
  });
});
