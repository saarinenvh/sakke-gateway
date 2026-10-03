import { describe, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { stateChangeExample, stateChangeSchema } from "./schema.js";

describe("display boundary schemas", () => {
  it("accept their examples", () => {
    parseOrThrow(stateChangeSchema, stateChangeExample, "display state change example");
  });
});
