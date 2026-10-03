import { parseToolArgs } from "../parameters.js";
import { runVacuumAction } from "../../features/tidiness/vacuumActions.js";
import { vacuumArgsSchema } from "./schema.js";

export function executeVacuum(args: Record<string, unknown>): Promise<string> {
  const { action } = parseToolArgs(vacuumArgsSchema, args, "vacuum");
  return runVacuumAction(action, Date.now());
}
