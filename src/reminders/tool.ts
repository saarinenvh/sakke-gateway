import type { Tool } from "../tools/types.js";
import { getTasksText, getCalendarText } from "./reminders.js";

const PERIOD = {
  type: "string",
  enum: ["today", "tomorrow", "this_week", "next_week"],
} as const;

export const getTasksTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "get_tasks",
      description: "Get pending items from Google Tasks (todo list). Use ONLY for tasks, chores, or to-dos — things the user needs to DO. NOT for calendar events or appointments.",
      parameters: {
        type: "object",
        properties: {
          period: { ...PERIOD, description: "Time period to fetch tasks for. Defaults to today." },
        },
        required: [],
      },
    },
  },
  execute: args => getTasksText((args.period as string) ?? "today"),
};

export const getCalendarTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "get_calendar",
      description: "Get events from Google Calendar. Use ONLY for calendar events, appointments, meetings, or scheduled events — things happening at a specific time. NOT for tasks or to-dos.",
      parameters: {
        type: "object",
        properties: {
          period: { ...PERIOD, description: "Time period to fetch events for. Defaults to today." },
        },
        required: [],
      },
    },
  },
  execute: args => getCalendarText((args.period as string) ?? "today"),
};
