import type { DataSource, Repository } from "typeorm";
import { MorningBrief, type MorningStartSource } from "./MorningBrief.entity.js";
import { MorningDay, type StepOutcome } from "./MorningDay.entity.js";
import { MorningState } from "./MorningState.entity.js";
import { coffeeStateOf, type CoffeeState } from "./policy.js";

// The migration creates this row; it is only ever updated.
const STATE_ROW_ID = 1;

export type WakeStep = "lights" | "coffeeMaker" | "greeting";

export interface WakeDay {
  localDate: string;
  alarmAt: number;
  startedAt: number;
}

export type WakeReservation = { kind: "reserved"; coffee: CoffeeState } | { kind: "already_reserved" };

export interface BriefDay {
  localDate: string;
  morningStartAt: number;
  startSource: MorningStartSource;
  text: string;
  reservedAt: number;
}

export type BriefReservation = { kind: "reserved" } | { kind: "already_reserved" };

// The only code that writes morning_state, morning_day and morning_brief.
export class MorningRepository {
  private readonly state: Repository<MorningState>;
  private readonly days: Repository<MorningDay>;
  private readonly briefs: Repository<MorningBrief>;

  constructor(private readonly dataSource: DataSource) {
    this.state = dataSource.getRepository(MorningState);
    this.days = dataSource.getRepository(MorningDay);
    this.briefs = dataSource.getRepository(MorningBrief);
  }

  async loadArmedAlarm(): Promise<number | null> {
    const row = await this.state.findOneByOrFail({ id: STATE_ROW_ID });
    return row.armedAlarmAt?.getTime() ?? null;
  }

  async saveArmedAlarm(at: number | null): Promise<void> {
    await this.state.update({ id: STATE_ROW_ID }, { armedAlarmAt: at === null ? null : new Date(at) });
  }

  async saveCoffeeAnswer(loaded: boolean, answeredAt: number): Promise<void> {
    await this.state.update({ id: STATE_ROW_ID }, { coffeeLoaded: loaded, coffeeAnsweredAt: new Date(answeredAt) });
  }

  // In one transaction: the day's row is created, the coffee answer is copied
  // into it and cleared. A crash after this can neither wake the day again nor
  // leave a "loaded" answer behind for a later alarm.
  async reserveWake(day: WakeDay, coffeeValidAfter: number): Promise<WakeReservation> {
    return this.dataSource.transaction(async manager => {
      // Locked first, so concurrent reservations queue here and the check below
      // sees any day another one created.
      const state = await manager.findOneOrFail(MorningState, {
        where: { id: STATE_ROW_ID },
        lock: { mode: "pessimistic_write" },
      });
      if (await manager.existsBy(MorningDay, { localDate: day.localDate })) return { kind: "already_reserved" };

      const answer = state.coffeeLoaded === null || state.coffeeAnsweredAt === null
        ? null
        : { loaded: state.coffeeLoaded, answeredAt: state.coffeeAnsweredAt.getTime() };
      const coffee = coffeeStateOf(answer, coffeeValidAfter);

      await manager.insert(MorningDay, {
        localDate: day.localDate,
        alarmAt: new Date(day.alarmAt),
        status: "started",
        coffee,
        lights: null,
        coffeeMaker: null,
        greeting: null,
        startedAt: new Date(day.startedAt),
        finishedAt: null,
      });
      await manager.update(MorningState, { id: STATE_ROW_ID }, { coffeeLoaded: null, coffeeAnsweredAt: null });
      return { kind: "reserved", coffee };
    });
  }

  async recordWakeStep(localDate: string, step: WakeStep, outcome: StepOutcome): Promise<void> {
    await this.days.update({ localDate }, { [step]: outcome });
  }

  async finishWake(localDate: string, finishedAt: number): Promise<void> {
    await this.days.update({ localDate }, { status: "done", finishedAt: new Date(finishedAt) });
  }

  // When the day's alarm woke the house, or null if it didn't.
  async loadWakeAlarm(localDate: string): Promise<number | null> {
    const day = await this.days.findOneBy({ localDate });
    return day?.alarmAt.getTime() ?? null;
  }

  async hasBrief(localDate: string): Promise<boolean> {
    return this.briefs.existsBy({ localDate });
  }

  async loadBriefText(localDate: string): Promise<string | null> {
    const brief = await this.briefs.findOneBy({ localDate });
    return brief?.text ?? null;
  }

  // Takes the same lock as reserveWake, so two reservations for one day queue
  // and the second sees the first.
  async reserveBrief(brief: BriefDay): Promise<BriefReservation> {
    return this.dataSource.transaction(async manager => {
      await manager.findOneOrFail(MorningState, { where: { id: STATE_ROW_ID }, lock: { mode: "pessimistic_write" } });
      if (await manager.existsBy(MorningBrief, { localDate: brief.localDate })) return { kind: "already_reserved" };

      await manager.insert(MorningBrief, {
        localDate: brief.localDate,
        morningStartAt: new Date(brief.morningStartAt),
        startSource: brief.startSource,
        status: "uncertain",
        text: brief.text,
        reservedAt: new Date(brief.reservedAt),
        deliveredAt: null,
      });
      return { kind: "reserved" };
    });
  }

  async markBriefDelivered(localDate: string, deliveredAt: number): Promise<void> {
    await this.briefs.update({ localDate }, { status: "delivered", deliveredAt: new Date(deliveredAt) });
  }
}
