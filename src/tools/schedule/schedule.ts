import { parseToolArgs } from "../parameters.js";
import { config } from "../../config.js";
import { activeScheduler, defaultAnnouncement, type Scheduler } from "../../features/scheduling/scheduler.js";
import type { ScheduledJob } from "../../features/scheduling/ScheduledJob.entity.js";
import { scheduleRequestSchema, type SetRequest } from "./schema.js";

const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

export const SCHEDULING_UNAVAILABLE = "Scheduling isn't available right now.";

export async function executeSchedule(args: Record<string, unknown>): Promise<string> {
  const scheduler = activeScheduler();
  if (!scheduler) return SCHEDULING_UNAVAILABLE;

  const request = parseToolArgs(scheduleRequestSchema, args, "schedule");
  switch (request.action) {
    case "set":
      return setJob(scheduler, request);
    case "cancel":
      return cancelJob(scheduler, request.job_id);
    case "list":
      return listJobs(scheduler);
  }
}

async function setJob(scheduler: Scheduler, request: SetRequest): Promise<string> {
  const delayMs = Math.round(request.when.in_minutes * MINUTE_MS);
  if (delayMs < SECOND_MS) return "That's too soon to schedule - give it at least a second.";

  const call = request.run ?? defaultAnnouncement(request.label);
  const result = await scheduler.schedule({
    runAt: new Date(Date.now() + delayMs),
    source: "in",
    tool: call.tool,
    args: call.args,
    label: request.label,
  });

  if (result.kind === "not_schedulable") return `${result.tool} can't be scheduled.`;
  const { job } = result;
  return `Scheduled for ${localTime(job.runAt)}, in ${describeDelay(delayMs)}: ${job.label}. ID: ${job.id}.`;
}

// Without an id, the only scheduled job is the one meant.
async function cancelJob(scheduler: Scheduler, idOrLabel: string | undefined): Promise<string> {
  const pending = scheduler.listPending();
  if (pending.length === 0) return "Nothing is scheduled.";

  const key = idOrLabel ?? (pending.length === 1 ? pending[0].id : undefined);
  if (key === undefined) {
    return `Several things are scheduled: ${pending.map(job => `${job.id} (${job.label})`).join(", ")}. Say which one to cancel.`;
  }

  const cancelled = await scheduler.cancel(key);
  return cancelled ? `Cancelled: ${cancelled.label}.` : "Nothing scheduled matches that.";
}

function listJobs(scheduler: Scheduler): string {
  const pending = scheduler.listPending();
  if (pending.length === 0) return "Nothing is scheduled.";
  return pending.map(describeJob).join("\n");
}

function describeJob(job: ScheduledJob): string {
  const remainingMs = Math.max(0, job.runAt.getTime() - Date.now());
  return `${job.id}: "${job.label}" at ${localTime(job.runAt)}, in ${describeDelay(remainingMs)}`;
}

function localTime(at: Date): string {
  return at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: config.timezone });
}

function describeDelay(delayMs: number): string {
  if (delayMs < MINUTE_MS) {
    const seconds = Math.round(delayMs / SECOND_MS);
    return seconds === 1 ? "1 second" : `${seconds} seconds`;
  }
  const minutes = Math.round(delayMs / MINUTE_MS);
  if (minutes < 60) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hoursText = hours === 1 ? "1 hour" : `${hours} hours`;
  return rest === 0 ? hoursText : `${hoursText} ${rest} ${rest === 1 ? "minute" : "minutes"}`;
}
