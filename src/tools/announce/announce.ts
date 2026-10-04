import { parseToolArgs } from "../parameters.js";
import type { ToolContext } from "../types.js";
import { config } from "../../config.js";
import { announce } from "../../features/announcements/announcements.js";
import { localTimeOfDay } from "../../util/time.js";
import { announceArgsSchema } from "./schema.js";

// A scheduled announcement this much after its time says it's late; the usual
// few seconds of a timer firing don't count.
const LATE_NOTICE_AFTER_MS = 60_000;

export async function executeAnnounce(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const { message } = parseToolArgs(announceArgsSchema, args, "announce");
  const { wording } = await announce(withLateNotice(message, ctx.scheduledFor, new Date()), ctx.log);
  return wording === "generated" ? "Announced." : "Announced, with the message as written.";
}

function withLateNotice(message: string, scheduledFor: Date | undefined, now: Date): string {
  if (!scheduledFor || now.getTime() - scheduledFor.getTime() < LATE_NOTICE_AFTER_MS) return message;
  return `${message} (This was due at ${localTimeOfDay(scheduledFor, config.timezone)}.)`;
}
