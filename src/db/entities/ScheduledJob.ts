import { Column, Entity, Index, PrimaryColumn } from "typeorm";

// How the job's time was given: a duration ("in 10 minutes") or a clock time
// ("at 16:00"). Decides what happens to a job that came due while the gateway
// was down.
export const JOB_SOURCES = ["in", "at"] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

export const JOB_STATUSES = ["pending", "done", "failed", "cancelled", "dropped"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// A tool call stored to run later. Rows stay after they finish, as the
// history of what ran and how it went.
@Entity({ name: "scheduled_job" })
@Index("idx_scheduled_job_status_run_at", ["status", "runAt"])
export class ScheduledJob {
  @PrimaryColumn({ type: "varchar", length: 16 })
  id!: string;

  @Column({ name: "run_at", type: "datetime", precision: 3 })
  runAt!: Date;

  @Column({ type: "varchar", length: 8 })
  source!: JobSource;

  @Column({ type: "varchar", length: 64 })
  tool!: string;

  @Column({ type: "simple-json" })
  args!: Record<string, unknown>;

  @Column({ type: "varchar", length: 255 })
  label!: string;

  @Column({ type: "varchar", length: 16 })
  status!: JobStatus;

  @Column({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;

  @Column({ name: "finished_at", type: "datetime", precision: 3, nullable: true })
  finishedAt!: Date | null;

  @Column({ type: "text", nullable: true })
  result!: string | null;
}
