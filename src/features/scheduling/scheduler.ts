import { randomBytes } from "crypto";
import type { FastifyBaseLogger } from "fastify";
import type { JobSource, ScheduledJob } from "./ScheduledJob.entity.js";
import type { FinishedStatus, JobRepository } from "./jobRepository.js";

// What the scheduler needs from storage; JobRepository in production, a fake
// in tests.
export type JobStore = Pick<JobRepository, "insert" | "insertIgnoringExisting" | "listPending" | "finish">;

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

export interface SchedulerDeps {
  store: JobStore;
  runJob: JobRunner;
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

  // Arms every pending job. A duration job that came due while the gateway was
  // down is dropped rather than run late.
  async start(): Promise<void> {
    const pending = await this.deps.store.listPending();
    let dropped = 0;
    for (const job of pending) {
      if (this.cameDueWhileDown(job)) {
        await this.drop(job);
        dropped++;
        continue;
      }
      this.arm(job);
    }
    this.deps.log.info({ armed: this.armed.size, dropped }, "Scheduler started");
  }

  // Stored before it is armed: a job the caller has been told about survives a
  // restart.
  async schedule(request: JobRequest): Promise<ScheduledJob> {
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
    return job;
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

    const outcome = await this.run(job);
    await this.record(job, outcome.status, outcome.result);
  }

  private async run(job: ScheduledJob): Promise<JobOutcome> {
    try {
      return await this.deps.runJob(job);
    } catch (err) {
      return { status: "failed", result: err instanceof Error ? err.message : String(err) };
    }
  }

  // The job has already run; a failure to record it is logged, not retried.
  // After a restart the row is still pending, and a duration job is then
  // dropped rather than run a second time.
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
    return this.record(job, "dropped", "came due while the gateway was down");
  }

  // Clock-time jobs get their own late-running rule in Phase 2; until then only
  // duration jobs exist.
  private cameDueWhileDown(job: ScheduledJob): boolean {
    return job.source === "in" && job.runAt.getTime() <= this.deps.now().getTime();
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
