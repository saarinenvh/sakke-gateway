import { localTimeOfDay } from "../../util/time.js";

// A scheduled announcement this much after its time says it's late; the usual
// few seconds of a timer firing don't count.
const LATE_NOTICE_AFTER_MS = 60_000;

// The message, plus when it was due if it's being said late.
export function withLateNotice(message: string, scheduledFor: Date | undefined, now: Date, timezone: string): string {
  if (!scheduledFor || now.getTime() - scheduledFor.getTime() < LATE_NOTICE_AFTER_MS) return message;
  return `${message} (This was due at ${localTimeOfDay(scheduledFor, timezone)}.)`;
}
