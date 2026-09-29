import { z } from "zod";
import type { ToolContext } from "../types.js";
import { parseOrThrow } from "../../util/validation.js";
import { announce } from "../../features/announcements/announcer.js";

const announceArgsSchema = z.object({ message: z.string().trim().min(1) });

export async function executeAnnounce(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const { message } = parseOrThrow(announceArgsSchema, args, "announce tool arguments");
  const { wording } = await announce(message, ctx.log);
  return wording === "generated" ? "Announced." : "Announced, with the message as written.";
}
