import { describe, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { getCalendarArgsExample, getCalendarArgsSchema, getTasksArgsExample, getTasksArgsSchema } from "./schema.js";

describe("reminders schemas", () => {
  it("accept their examples", () => {
    parseOrThrow(getTasksArgsSchema, getTasksArgsExample, "get_tasks args example");
    parseOrThrow(getCalendarArgsSchema, getCalendarArgsExample, "get_calendar args example");
  });
});
