import { describe, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { scheduleArgsExample, scheduleArgsSchema, scheduleRequestSchema } from "./schema.js";

describe("schedule schemas", () => {
  it("accept their examples", () => {
    parseOrThrow(scheduleArgsSchema, scheduleArgsExample, "schedule args example");
    parseOrThrow(scheduleRequestSchema, scheduleArgsExample, "schedule request example");
  });
});
