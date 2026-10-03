import { describe, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { manageListArgsExample, manageListArgsSchema } from "./schema.js";

describe("manage_list schemas", () => {
  it("accept their examples", () => {
    parseOrThrow(manageListArgsSchema, manageListArgsExample, "manage_list args example");
  });
});
