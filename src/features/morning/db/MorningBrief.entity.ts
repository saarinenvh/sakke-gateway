import { Column, Entity, PrimaryColumn } from "typeorm";

export const MORNING_START_SOURCES = ["alarm", "watch"] as const;
export type MorningStartSource = (typeof MORNING_START_SOURCES)[number];

// "uncertain" from the reservation until the satellite confirms it spoke.
export const BRIEF_STATUSES = ["uncertain", "delivered"] as const;
export type BriefStatus = (typeof BRIEF_STATUSES)[number];

// One local day's summary. The row is created before speaking, so a day that
// exists is never briefed again, even if speaking timed out.
@Entity({ name: "morning_brief" })
export class MorningBrief {
  @PrimaryColumn({ name: "local_date", type: "varchar", length: 10 })
  localDate!: string;

  @Column({ name: "morning_start_at", type: "datetime", precision: 3 })
  morningStartAt!: Date;

  @Column({ name: "start_source", type: "varchar", length: 8 })
  startSource!: MorningStartSource;

  @Column({ type: "varchar", length: 16 })
  status!: BriefStatus;

  @Column({ type: "text" })
  text!: string;

  @Column({ name: "reserved_at", type: "datetime", precision: 3 })
  reservedAt!: Date;

  @Column({ name: "delivered_at", type: "datetime", precision: 3, nullable: true })
  deliveredAt!: Date | null;
}
