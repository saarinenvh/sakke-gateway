import { z } from "zod";

const period = z.enum(["today", "tomorrow", "this_week", "next_week"]);

// Model → gateway: the arguments of a get_tasks tool call.

export const getTasksArgsExample = { period: "this_week" };

export const getTasksArgsSchema = z.object({
  period: period.describe("Time period to fetch tasks for. Defaults to today.").optional(),
});

// Model → gateway: the arguments of a get_calendar tool call.

export const getCalendarArgsExample = { period: "tomorrow" };

export const getCalendarArgsSchema = z.object({
  period: period.describe("Time period to fetch events for. Defaults to today.").optional(),
});
