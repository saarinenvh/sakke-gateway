import type { DataSource, QueryDeepPartialEntity, Repository } from "typeorm";
import { ScheduledJob, type JobStatus } from "./ScheduledJob.entity.js";

export type FinishedStatus = Exclude<JobStatus, "pending">;

// The only code that writes scheduled_job. Every method resolves once its write
// is committed, so a job the scheduler has acknowledged, cancelled or finished
// stays that way across a restart.
export class JobRepository {
  private readonly jobs: Repository<ScheduledJob>;

  constructor(dataSource: DataSource) {
    this.jobs = dataSource.getRepository(ScheduledJob);
  }

  async insert(job: ScheduledJob): Promise<void> {
    await this.jobs.insert(asInsertRow(job));
  }

  // For a one-time import that may be repeated: a job whose id already exists
  // is left as it is.
  async insertIgnoringExisting(jobs: ScheduledJob[]): Promise<void> {
    if (jobs.length === 0) return;
    await this.jobs.createQueryBuilder().insert().values(jobs.map(asInsertRow)).orIgnore().execute();
  }

  async listPending(): Promise<ScheduledJob[]> {
    return this.jobs.find({ where: { status: "pending" }, order: { runAt: "ASC" } });
  }

  // Only a pending job changes, so a finished or cancelled one can't be
  // overwritten. Returns whether this one changed.
  async finish(id: string, status: FinishedStatus, result: string | null, finishedAt: Date): Promise<boolean> {
    const update = await this.jobs.update({ id, status: "pending" }, { status, result, finishedAt });
    return (update.affected ?? 0) > 0;
  }
}

// TypeORM's insert typing reads a JSON column's object as a nested entity and
// can't accept arbitrary tool arguments. args is a simple-json column, so any
// JSON object is a valid value.
function asInsertRow(job: ScheduledJob): QueryDeepPartialEntity<ScheduledJob> {
  return job as QueryDeepPartialEntity<ScheduledJob>;
}
