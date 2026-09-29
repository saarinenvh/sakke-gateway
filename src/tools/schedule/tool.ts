import type { Tool } from "../types.js";
import { executeSchedule } from "./schedule.js";

export const scheduleTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "schedule",
      description: "Timers and reminders: set one, cancel one, or list what's scheduled. 'Set a timer for 10 minutes for the pasta', 'remind me in half an hour to check the oven' -> set, with when.in_minutes and a short label; when it's time, you announce the label out loud. 'Cancel the pasta timer' -> cancel. 'What timers do I have?' -> list.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["set", "cancel", "list"] },
          when: {
            type: "object",
            description: "For set: when it should happen.",
            properties: {
              in_minutes: { type: "number", description: "Minutes from now, e.g. 10, or 0.5 for thirty seconds." },
            },
            required: ["in_minutes"],
          },
          label: { type: "string", description: "For set: what it's for, e.g. 'the pasta' or 'check the oven'. Announced when it's time." },
          job_id: { type: "string", description: "For cancel: the id from set or list, or part of the label. Leave out to cancel the only one." },
        },
        required: ["action"],
      },
    },
  },
  // Listing is harmless to repeat; setting or cancelling isn't.
  repeatable: args => args.action === "list",
  execute: executeSchedule,
};
