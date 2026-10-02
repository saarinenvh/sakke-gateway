import { Column, Entity, PrimaryColumn } from "typeorm";
import type { CoffeeState } from "./policy.js";

export const WAKE_STATUSES = ["started", "done"] as const;
export type WakeStatus = (typeof WAKE_STATUSES)[number];

export const STEP_OUTCOMES = ["done", "failed", "skipped"] as const;
export type StepOutcome = (typeof STEP_OUTCOMES)[number];

// One local day's wake-up. The row is created before the first action, so a
// day that exists is never woken again, whatever happened to its steps.
@Entity({ name: "morning_day" })
export class MorningDay {
  @PrimaryColumn({ name: "local_date", type: "varchar", length: 10 })
  localDate!: string;

  @Column({ name: "alarm_at", type: "datetime", precision: 3 })
  alarmAt!: Date;

  @Column({ type: "varchar", length: 16 })
  status!: WakeStatus;

  // The coffee answer as it stood at the reservation.
  @Column({ type: "varchar", length: 16 })
  coffee!: CoffeeState;

  @Column({ type: "varchar", length: 16, nullable: true })
  lights!: StepOutcome | null;

  @Column({ name: "coffee_maker", type: "varchar", length: 16, nullable: true })
  coffeeMaker!: StepOutcome | null;

  @Column({ type: "varchar", length: 16, nullable: true })
  greeting!: StepOutcome | null;

  @Column({ name: "started_at", type: "datetime", precision: 3 })
  startedAt!: Date;

  @Column({ name: "finished_at", type: "datetime", precision: 3, nullable: true })
  finishedAt!: Date | null;
}
