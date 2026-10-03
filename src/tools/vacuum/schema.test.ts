import { describe, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { vacuumArgsExample, vacuumArgsSchema } from "./schema.js";

describe("vacuum schemas", () => {
  it("accept their examples", () => {
    parseOrThrow(vacuumArgsSchema, vacuumArgsExample, "vacuum args example");
  });
});
