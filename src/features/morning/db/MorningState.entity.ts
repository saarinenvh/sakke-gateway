import { Column, Entity, PrimaryColumn } from "typeorm";

// The one row of standing morning state: the alarm being watched, and the
// coffee answer waiting for the next wake-up.
@Entity({ name: "morning_state" })
export class MorningState {
  @PrimaryColumn({ type: "tinyint" })
  id!: number;

  @Column({ name: "armed_alarm_at", type: "datetime", precision: 3, nullable: true })
  armedAlarmAt!: Date | null;

  @Column({ name: "coffee_loaded", type: "boolean", nullable: true })
  coffeeLoaded!: boolean | null;

  @Column({ name: "coffee_answered_at", type: "datetime", precision: 3, nullable: true })
  coffeeAnsweredAt!: Date | null;
}
