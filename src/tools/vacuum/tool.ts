import { z } from "zod";
import type { Tool } from "../types.js";
import { parseOrThrow } from "../../util/validation.js";
import { READ_ONLY_VACUUM_ACTIONS, runVacuumAction, VACUUM_ACTIONS } from "./vacuum.js";

const vacuumArgsSchema = z.object({ action: z.enum(VACUUM_ACTIONS) });

export const vacuumTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "vacuum",
      description: "Control the robot vacuum and cleaning reminders. 'Clean the house', 'vacuum', 'start the robot' -> start. 'Stop the vacuum' -> stop. 'Send it home' -> dock. 'How's the vacuum?' -> status. 'When did I last clean?', 'when was the house last cleaned?' -> last_cleaned. 'I cleaned the house' -> mark_cleaned. After you asked whether to clean: a no -> decline, 'stop reminding me' or 'leave me alone' -> snooze.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [...VACUUM_ACTIONS],
            description: "decline and snooze only answer a cleaning reminder you asked.",
          },
        },
        required: ["action"],
      },
    },
  },
  repeatable: args => typeof args.action === "string" && READ_ONLY_VACUUM_ACTIONS.has(args.action),
  execute: args => {
    const { action } = parseOrThrow(vacuumArgsSchema, args, "vacuum tool arguments");
    return runVacuumAction(action, Date.now());
  },
};
