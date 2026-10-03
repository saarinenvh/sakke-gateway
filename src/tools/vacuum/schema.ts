import { z } from "zod";
import { VACUUM_ACTIONS } from "./vacuum.js";

// Model → gateway: the arguments of a vacuum tool call.

export const vacuumArgsExample = { action: "start" };

export const vacuumArgsSchema = z.object({
  action: z.enum(VACUUM_ACTIONS).describe("decline and snooze only answer a cleaning reminder you asked."),
});
