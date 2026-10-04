import type { Tool } from "../types.js";
import { toolParameters } from "../parameters.js";
import { vacuumArgsSchema } from "./schema.js";
import { READ_ONLY_VACUUM_ACTIONS, SCHEDULABLE_VACUUM_ACTIONS } from "../../features/tidiness/vacuumActions.js";
import { executeVacuum } from "./vacuum.js";

export const vacuumTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "vacuum",
      description: "Control the robot vacuum and cleaning reminders. 'Clean the house', 'vacuum', 'start the robot' -> start. 'Stop the vacuum' -> stop. 'Send it home' -> dock. 'How's the vacuum?' -> status. 'When did I last clean?', 'when was the house last cleaned?' -> last_cleaned. 'I cleaned the house' -> mark_cleaned. After you asked whether to clean: a no -> decline, 'stop reminding me' or 'leave me alone' -> snooze.",
      parameters: toolParameters(vacuumArgsSchema),
    },
  },
  repeatable: args => typeof args.action === "string" && READ_ONLY_VACUUM_ACTIONS.has(args.action),
  schedulable: args => typeof args.action === "string" && SCHEDULABLE_VACUUM_ACTIONS.has(args.action),
  execute: executeVacuum,
};
