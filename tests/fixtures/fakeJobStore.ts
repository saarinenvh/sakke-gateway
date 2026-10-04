import type { ScheduledJob } from "../../src/features/scheduling/db/ScheduledJob.entity.js";
import { FINISHED_FROM, type FinishedStatus } from "../../src/features/scheduling/db/jobRepository.js";
import type { JobStore } from "../../src/features/scheduling/scheduling.js";

// JobRepository's contract in memory. The real repository is tested against
// MariaDB in tests/integration/database.test.ts.
export class FakeJobStore implements JobStore {
  private readonly jobs = new Map<string, ScheduledJob>();
  /** Makes the next write fail, like a dropped database connection. */
  failNextWrite = false;

  async insert(job: ScheduledJob): Promise<void> {
    this.failIfAsked();
    if (this.jobs.has(job.id)) throw new Error(`Duplicate entry '${job.id}' for key 'PRIMARY'`);
    this.jobs.set(job.id, { ...job });
  }

  async insertIgnoringExisting(jobs: ScheduledJob[]): Promise<void> {
    this.failIfAsked();
    for (const job of jobs) {
      if (!this.jobs.has(job.id)) this.jobs.set(job.id, { ...job });
    }
  }

  async listPending(): Promise<ScheduledJob[]> {
    return this.all()
      .filter(job => job.status === "pending")
      .sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
  }

  async listRunning(): Promise<ScheduledJob[]> {
    return this.all().filter(job => job.status === "running");
  }

  async claim(id: string): Promise<boolean> {
    this.failIfAsked();
    const job = this.jobs.get(id);
    if (!job || job.status !== "pending") return false;
    this.jobs.set(id, { ...job, status: "running" });
    return true;
  }

  async finish(id: string, status: FinishedStatus, result: string | null, finishedAt: Date): Promise<boolean> {
    this.failIfAsked();
    const job = this.jobs.get(id);
    if (!job || job.status !== FINISHED_FROM[status]) return false;
    this.jobs.set(id, { ...job, status, result, finishedAt });
    return true;
  }

  get(id: string): ScheduledJob | undefined {
    const job = this.jobs.get(id);
    return job && { ...job };
  }

  all(): ScheduledJob[] {
    return [...this.jobs.values()].map(job => ({ ...job }));
  }

  private failIfAsked(): void {
    if (!this.failNextWrite) return;
    this.failNextWrite = false;
    throw new Error("Connection lost: The server closed the connection.");
  }
}
