import { randomBytes } from "crypto";
import type { FastifyBaseLogger } from "fastify";
import type { JobSource, ScheduledJob } from "./db/ScheduledJob.entity.js";
import type { FinishedStatus, JobRepository } from "./db/jobRepository.js";
import { CLOCK_TIME_GRACE_MS, decideMissedJob } from "./policy.js";

// What the scheduler needs from storage; JobRepository in production, a fake
// in tests.
export type JobStore = Pick<JobRepository, "insert" | "insertIgnoringExisting" | "listPending" | "listRunning" | "claim" | "finish">;

export interface JobOutcome {
  status: Extract<FinishedStatus, "done" | "failed">;
  result: string;
}

// Runs a job's stored tool call. Injected (index.ts) rather than imported: the
// tool registry includes the schedule tool, which uses this module.
export type JobRunner = (job: ScheduledJob) => Promise<JobOutcome>;

export interface JobRequest {
  runAt: Date;
  source: JobSource;
  tool: string;
  args: Record<string, unknown>;
  label: string;
}

export const ANNOUNCE_TOOL = "announce";

// What a job does when it was given only a label: Sakke announces it.
export function defaultAnnouncement(label: string): { tool: string; args: Record<string, unknown> } {
  return { tool: ANNOUNCE_TOOL, args: { message: `Time's up: ${label}.` } };
}

// Tells the owner how a job went, once its outcome is recorded. Injected for
// the same reason as the runner.
export type OutcomeReporter = (job: ScheduledJob, outcome: JobOutcome) => Promise<void>;

// Whether a tool call may run unattended. Injected for the same reason as the
// runner.
export type SchedulabilityCheck = (tool: string, args: Record<string, unknown>) => boolean;

export type ScheduleResult =
  | { kind: "scheduled"; job: ScheduledJob }
  | { kind: "not_schedulable"; tool: string };

export interface SchedulerDeps {
  store: JobStore;
  runJob: JobRunner;
  reportOutcome: OutcomeReporter;
  isSchedulable: SchedulabilityCheck;
  now: () => Date;
  log: FastifyBaseLogger;
}

// setTimeout's longest delay, about 24.8 days. A job further out is re-armed
// when it elapses.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

// Enough to read what happened; a whole wiki page doesn't belong in the history.
const MAX_STORED_RESULT_CHARS = 1_000;

// Six hex characters: short enough to say, and cancel reads it back.
const JOB_ID_BYTES = 3;

export class Scheduler {
  private readonly armed = new Map<string, { job: ScheduledJob; timer: NodeJS.Timeout }>();

  constructor(private readonly deps: SchedulerDeps) {}

  // Arms every pending job. One that came due while the gateway was down runs
  // late or is dropped, by the rule in policy.ts. One that was running when the
  // gateway stopped is recorded as failed, never run again.
  async start(): Promise<void> {
    for (const job of await this.deps.store.listRunning()) {
      await this.record(job, "failed", "outcome unknown: it was running when the gateway stopped");
    }

    const pending = await this.deps.store.listPending();
    let dropped = 0;
    for (const job of pending) {
      if (this.isDue(job) && decideMissedJob(job, this.deps.now()) === "drop") {
        await this.drop(job);
        dropped++;
        continue;
      }
      this.arm(job);
    }
    this.deps.log.info({ armed: this.armed.size, dropped }, "Scheduler started");
  }

  // Only a call that may run unattended is accepted. It is stored before it is
  // armed: a job the caller has been told about survives a restart.
  async schedule(request: JobRequest): Promise<ScheduleResult> {
    if (!this.deps.isSchedulable(request.tool, request.args)) {
      return { kind: "not_schedulable", tool: request.tool };
    }

    const job: ScheduledJob = {
      id: createJobId(),
      ...request,
      status: "pending",
      createdAt: this.deps.now(),
      finishedAt: null,
      result: null,
    };
    await this.deps.store.insert(job);
    this.arm(job);
    this.deps.log.info({ jobId: job.id, tool: job.tool, runAt: job.runAt.toISOString(), label: job.label }, "Job scheduled");
    return { kind: "scheduled", job };
  }

  // By id, or by a label containing the text. The cancellation is committed
  // before the timer is cleared, so it can't come back after a restart.
  async cancel(idOrLabel: string): Promise<ScheduledJob | null> {
    const job = this.findPending(idOrLabel);
    if (!job) return null;

    const cancelled = await this.deps.store.finish(job.id, "cancelled", null, this.deps.now());
    this.disarm(job.id);
    if (!cancelled) return null;

    this.deps.log.info({ jobId: job.id, label: job.label }, "Job cancelled");
    return job;
  }

  listPending(): ScheduledJob[] {
    return [...this.armed.values()]
      .map(entry => entry.job)
      .sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
  }

  stop(): void {
    for (const id of [...this.armed.keys()]) this.disarm(id);
  }

  private arm(job: ScheduledJob): void {
    const delayMs = Math.max(0, job.runAt.getTime() - this.deps.now().getTime());
    const timer = setTimeout(() => void this.fireWhenDue(job), Math.min(delayMs, MAX_TIMER_DELAY_MS));
    this.armed.set(job.id, { job, timer });
  }

  private disarm(id: string): void {
    const entry = this.armed.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.armed.delete(id);
  }

  private async fireWhenDue(job: ScheduledJob): Promise<void> {
    if (job.runAt.getTime() > this.deps.now().getTime()) {
      this.arm(job);
      return;
    }
    this.armed.delete(job.id);
    if (!(await this.claim(job))) return;

    const outcome = await this.run(job);
    await this.record(job, outcome.status, outcome.result);
    await this.report(job, outcome);
  }

  // After the outcome is stored: a failure to say it doesn't change it.
  private async report(job: ScheduledJob, outcome: JobOutcome): Promise<void> {
    try {
      await this.deps.reportOutcome(job, outcome);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.deps.log.error({ jobId: job.id, err: reason }, "Could not report a scheduled job's outcome");
    }
  }

  // Marked running in the database before it runs, so a run cut short by a
  // stop is never repeated. If that can't be written, the job doesn't run now:
  // it stays pending, and the next start decides, as for any job missed while
  // the gateway was down. Missing an announcement is the quieter failure than
  // saying it twice.
  private async claim(job: ScheduledJob): Promise<boolean> {
    try {
      if (await this.deps.store.claim(job.id)) return true;
      this.deps.log.warn({ jobId: job.id }, "Due job is no longer pending, not running it");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.deps.log.error({ jobId: job.id, err: reason }, "Could not mark a due job as running, not running it now");
    }
    return false;
  }

  private async run(job: ScheduledJob): Promise<JobOutcome> {
    try {
      return await this.deps.runJob(job);
    } catch (err) {
      return { status: "failed", result: err instanceof Error ? err.message : String(err) };
    }
  }

  // The job has already run; a failure to record it is logged, not retried.
  // The row stays running, and the next start records it as failed rather
  // than running it again.
  private async record(job: ScheduledJob, status: FinishedStatus, result: string | null): Promise<void> {
    const stored = result === null ? null : result.slice(0, MAX_STORED_RESULT_CHARS);
    try {
      await this.deps.store.finish(job.id, status, stored, this.deps.now());
      this.deps.log.info({ jobId: job.id, tool: job.tool, status, result: stored }, "Job finished");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.deps.log.error({ jobId: job.id, status, err: reason }, "Could not record a scheduled job's outcome");
    }
  }

  private drop(job: ScheduledJob): Promise<void> {
    const reason = job.source === "in"
      ? "came due while the gateway was down"
      : `came due more than ${CLOCK_TIME_GRACE_MS / 60_000} minutes before the gateway was back`;
    return this.record(job, "dropped", reason);
  }

  private isDue(job: ScheduledJob): boolean {
    return job.runAt.getTime() <= this.deps.now().getTime();
  }

  private findPending(idOrLabel: string): ScheduledJob | undefined {
    const byId = this.armed.get(idOrLabel);
    if (byId) return byId.job;
    const text = idOrLabel.toLowerCase();
    return this.listPending().find(job => job.label.toLowerCase().includes(text));
  }
}

function createJobId(): string {
  return randomBytes(JOB_ID_BYTES).toString("hex");
}

// The running scheduler, once the database is connected. Until then scheduling
// is unavailable.
let active: Scheduler | undefined;

export function activeScheduler(): Scheduler | undefined {
  return active;
}

export async function startScheduler(deps: SchedulerDeps): Promise<Scheduler> {
  const scheduler = new Scheduler(deps);
  await scheduler.start();
  active = scheduler;
  return scheduler;
}

export function stopScheduler(): void {
  active?.stop();
  active = undefined;
}
