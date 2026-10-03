import { describe, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { gpuStatusPushExample, gpuStatusPushSchema } from "./schema.js";

describe("gpu boundary schemas", () => {
  it("accept their examples", () => {
    parseOrThrow(gpuStatusPushSchema, gpuStatusPushExample, "gpu status push example");
  });
});
