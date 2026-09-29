import type { Tool } from "../types.js";
import { executeAnnounce } from "./announce.js";

export const announceTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "announce",
      description: "Speak a message out loud on the voice satellite, in your own words. For reminders and timers at a scheduled time, not for replying in a conversation.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "What to tell the owner, e.g. 'take the minced meat out of the fridge'." },
        },
        required: ["message"],
      },
    },
  },
  // Speaking the same thing twice is never what was asked for.
  repeatable: () => false,
  execute: executeAnnounce,
};
