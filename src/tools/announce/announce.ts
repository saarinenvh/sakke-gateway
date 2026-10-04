import { parseToolArgs } from "../parameters.js";
import type { ToolContext } from "../types.js";
import { announce } from "../../features/announcements/announcements.js";
import { announceArgsSchema } from "./schema.js";

export async function executeAnnounce(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const { message } = parseToolArgs(announceArgsSchema, args, "announce");
  const { wording } = await announce(message, ctx.log);
  return wording === "generated" ? "Announced." : "Announced, with the message as written.";
}
