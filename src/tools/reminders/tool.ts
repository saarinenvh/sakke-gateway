import type { Tool } from "../types.js";
import { toolParameters, parseToolArgs } from "../parameters.js";
import { getTasksText, getCalendarText } from "./reminders.js";
import { getCalendarArgsSchema, getTasksArgsSchema } from "./schema.js";

export const getTasksTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "get_tasks",
      description: "Get pending items from Google Tasks (todo list). Use ONLY for tasks, chores, or to-dos — things the user needs to DO. NOT for calendar events or appointments.",
      parameters: toolParameters(getTasksArgsSchema),
    },
  },
  repeatable: () => true,
  execute: args => getTasksText(parseToolArgs(getTasksArgsSchema, args, "get_tasks").period),
};

export const getCalendarTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "get_calendar",
      description: "Get events from Google Calendar. Use ONLY for calendar events, appointments, meetings, or scheduled events — things happening at a specific time. NOT for tasks or to-dos.",
      parameters: toolParameters(getCalendarArgsSchema),
    },
  },
  repeatable: () => true,
  execute: args => getCalendarText(parseToolArgs(getCalendarArgsSchema, args, "get_calendar").period),
};
