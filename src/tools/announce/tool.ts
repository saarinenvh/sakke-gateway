import type { Tool } from "../types.js";
import { toolParameters } from "../parameters.js";
import { executeAnnounce } from "./announce.js";
import { announceArgsSchema } from "./schema.js";

export const announceTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "announce",
      description: "Speak a message out loud on the voice satellite, in your own words. For reminders and timers at a scheduled time, not for replying in a conversation.",
      parameters: toolParameters(announceArgsSchema),
    },
  },
  // Speaking the same thing twice is never what was asked for.
  repeatable: () => false,
  schedulable: () => true,
  execute: executeAnnounce,
};
