import type { Tool } from "../types.js";
import { toolParameters } from "../parameters.js";
import { executeSchedule } from "./schedule.js";
import { scheduleArgsSchema } from "./schema.js";

export const scheduleTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "schedule",
      description: "Timers and reminders: set one, cancel one, or list what's scheduled. 'Set a timer for 10 minutes for the pasta', 'remind me in half an hour to check the oven' -> set, with when.in_minutes and a short label; when it's time, you announce the label out loud. 'Cancel the pasta timer' -> cancel. 'What timers do I have?' -> list.",
      parameters: toolParameters(scheduleArgsSchema),
    },
  },
  // Listing is harmless to repeat; setting or cancelling isn't.
  repeatable: args => args.action === "list",
  execute: executeSchedule,
};
