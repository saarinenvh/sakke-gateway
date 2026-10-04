import { parseToolArgs } from "../parameters.js";
import type { ToolContext } from "../types.js";
import { config } from "../../config.js";
import { announce } from "../../features/announcements/announcer.js";
import { withLateNotice } from "../../features/announcements/messages.js";
import { announceArgsSchema } from "./schema.js";

export async function executeAnnounce(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const { message } = parseToolArgs(announceArgsSchema, args, "announce");
  const { wording } = await announce(withLateNotice(message, ctx.scheduledFor, new Date(), config.timezone), ctx.log);
  return wording === "generated" ? "Announced." : "Announced, with the message as written.";
}
