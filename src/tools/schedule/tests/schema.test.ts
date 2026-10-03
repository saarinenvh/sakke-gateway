import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../../util/validation.js";
import { scheduleArgsExample, scheduleArgsSchema, scheduleRequestSchema } from "../schema.js";

describe("schedule schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(scheduleArgsSchema, scheduleArgsExample, "schedule args example")).not.toThrow();
    expect(() => parseOrThrow(scheduleRequestSchema, scheduleArgsExample, "schedule request example")).not.toThrow();
  });
});
