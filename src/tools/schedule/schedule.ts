import { parseToolArgs } from "../parameters.js";
import { config } from "../../config.js";
import { activeScheduler, defaultAnnouncement, type Scheduler } from "../../features/scheduling/scheduler.js";
import { resolveClockTime } from "../../features/scheduling/policy.js";
import type { JobSource, ScheduledJob } from "../../features/scheduling/db/ScheduledJob.entity.js";
import { addDays, localDate, localTimeOfDay } from "../../util/time.js";
import { scheduleRequestSchema, type ScheduleWhen, type SetRequest } from "./schema.js";

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

type Timing =
  | { kind: "due"; runAt: Date; source: JobSource; spoken: string }
  | { kind: "refused"; reply: string };

async function setJob(scheduler: Scheduler, request: SetRequest): Promise<string> {
  const timing = resolveTiming(request.when, new Date());
  if (timing.kind === "refused") return timing.reply;

  const call = request.run ?? defaultAnnouncement(request.label);
  const result = await scheduler.schedule({
    runAt: timing.runAt,
    source: timing.source,
    tool: call.tool,
    args: call.args,
    label: request.label,
  });

  if (result.kind === "not_schedulable") return `${result.tool} can't be scheduled.`;
  const { job } = result;
  return `Scheduled for ${timing.spoken}: ${job.label}. ID: ${job.id}.`;
}

// When the job is due, and how to say it back, so a misheard time is caught.
function resolveTiming(when: ScheduleWhen, now: Date): Timing {
  if (when.kind === "in") {
    const delayMs = Math.round(when.minutes * MINUTE_MS);
    if (delayMs < SECOND_MS) return { kind: "refused", reply: "That's too soon to schedule - give it at least a second." };
    const runAt = new Date(now.getTime() + delayMs);
    return { kind: "due", runAt, source: "in", spoken: `${localTime(runAt)}, in ${describeDelay(delayMs)}` };
  }

  const resolution = resolveClockTime(when.time, now, config.timezone);
  switch (resolution.kind) {
    case "resolved":
      return { kind: "due", runAt: resolution.runAt, source: "at", spoken: `${localTime(resolution.runAt)} ${resolution.day}` };
    case "contradictory":
      return { kind: "refused", reply: "That time contradicts itself (an hour of 13 or more with am, or 0 with pm). Nothing was scheduled; ask which time was meant." };
    case "passed_today":
      return { kind: "refused", reply: "That time has already passed today. Nothing was scheduled." };
  }
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
  const now = new Date();
  const remainingMs = Math.max(0, job.runAt.getTime() - now.getTime());
  return `${job.id}: "${job.label}" at ${localTime(job.runAt)}${dayAfterToday(job.runAt, now)}, in ${describeDelay(remainingMs)}`;
}

// Nothing for today; " tomorrow", or the date, for a later day.
function dayAfterToday(at: Date, now: Date): string {
  const today = localDate(now.getTime(), config.timezone);
  const day = localDate(at.getTime(), config.timezone);
  if (day === today) return "";
  return day === addDays(today, 1) ? " tomorrow" : ` on ${day}`;
}

function localTime(at: Date): string {
  return localTimeOfDay(at, config.timezone);
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
