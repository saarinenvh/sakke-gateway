import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../../util/validation.js";
import { getCalendarArgsExample, getCalendarArgsSchema, getTasksArgsExample, getTasksArgsSchema } from "../schema.js";

describe("reminders schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(getTasksArgsSchema, getTasksArgsExample, "get_tasks args example")).not.toThrow();
    expect(() => parseOrThrow(getCalendarArgsSchema, getCalendarArgsExample, "get_calendar args example")).not.toThrow();
  });
});
