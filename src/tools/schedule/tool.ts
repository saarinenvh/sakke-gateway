import type { Tool } from "../types.js";
import { toolParameters } from "../parameters.js";
import { executeSchedule } from "./schedule.js";
import { scheduleArgsSchema } from "./schema.js";

export const scheduleTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "schedule",
      description: "Timers and reminders: set one, cancel one, or list what's scheduled. When it's time, you announce the label out loud. 'Set a timer for 10 minutes for the pasta', 'remind me in half an hour to check the oven' -> set with when.in_minutes. 'Remind me at 4 pm to take the meat out' -> set with when.at {hour: 4, meridiem: 'pm'}; 'at half past six' -> {hour: 6, minute: 30, meridiem: 'unspecified'}; 'tomorrow at 7' -> {hour: 7, meridiem: 'unspecified', day: 'tomorrow'}. Give the hour as said and never work out the time yourself; the reply says the time back. 'Cancel the pasta timer' -> cancel. 'What timers do I have?' -> list.",
      parameters: toolParameters(scheduleArgsSchema),
    },
  },
  // Listing is harmless to repeat; setting or cancelling isn't.
  repeatable: args => args.action === "list",
  execute: executeSchedule,
};
