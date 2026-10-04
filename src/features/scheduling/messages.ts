import { localTimeOfDay } from "../../util/time.js";
import { withLateNotice } from "../announcements/messages.js";
import type { ScheduledJob } from "./db/ScheduledJob.entity.js";
import type { JobOutcome } from "./scheduling.js";

// What Sakke is asked to say after a scheduled action ran. It's worded in
// Sakke's voice when it's spoken, and said as it is if that fails.
export function outcomeMessage(job: Pick<ScheduledJob, "label" | "runAt">, outcome: JobOutcome, now: Date, timezone: string): string {
  const time = localTimeOfDay(now, timezone);
  const message = outcome.status === "done"
    ? `It's ${time}: done as scheduled, ${job.label}. ${outcome.result}`
    : `It's ${time}: the scheduled "${job.label}" didn't work. ${outcome.result}`;
  return withLateNotice(message, job.runAt, now, timezone);
}
