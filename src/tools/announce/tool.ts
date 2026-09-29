import { z } from "zod";
import type { Tool } from "../types.js";
import { parseOrThrow } from "../../util/validation.js";
import { announce } from "./announce.js";

const announceArgsSchema = z.object({ message: z.string().trim().min(1) });

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
  execute: async (args, ctx) => {
    const { message } = parseOrThrow(announceArgsSchema, args, "announce tool arguments");
    const { wording } = await announce(message, ctx.log);
    return wording === "generated" ? "Announced." : "Announced, with the message as written.";
  },
};
