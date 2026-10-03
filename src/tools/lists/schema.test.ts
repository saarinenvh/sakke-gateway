import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { manageListArgsExample, manageListArgsSchema } from "./schema.js";

describe("manage_list schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(manageListArgsSchema, manageListArgsExample, "manage_list args example")).not.toThrow();
  });
});
