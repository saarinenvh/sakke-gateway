import type { MorningStore } from "../../src/features/morning/coach.js";
import type { StepOutcome } from "../../src/features/morning/MorningDay.entity.js";
import type { WakeDay, WakeReservation, WakeStep } from "../../src/features/morning/morningRepository.js";
import { coffeeStateOf, type CoffeeAnswer, type CoffeeState } from "../../src/features/morning/policy.js";

export interface FakeWakeDay {
  alarmAt: number;
  status: "started" | "done";
  coffee: CoffeeState;
  steps: Partial<Record<WakeStep, StepOutcome>>;
}

// MorningRepository's contract in memory. The real repository is tested
// against MariaDB in tests/integration/database.test.ts.
export class FakeMorningStore implements MorningStore {
  armedAlarmAt: number | null = null;
  coffeeAnswer: CoffeeAnswer | null = null;
  readonly days = new Map<string, FakeWakeDay>();
  /** Makes the next reservation fail, like a dropped database connection. */
  failNextReservation = false;

  async loadArmedAlarm(): Promise<number | null> {
    return this.armedAlarmAt;
  }

  async saveArmedAlarm(at: number | null): Promise<void> {
    this.armedAlarmAt = at;
  }

  async saveCoffeeAnswer(loaded: boolean, answeredAt: number): Promise<void> {
    this.coffeeAnswer = { loaded, answeredAt };
  }

  // All or nothing, like the real transaction.
  async reserveWake(day: WakeDay, coffeeValidAfter: number): Promise<WakeReservation> {
    if (this.failNextReservation) {
      this.failNextReservation = false;
      throw new Error("Connection lost: The server closed the connection.");
    }
    if (this.days.has(day.localDate)) return { kind: "already_reserved" };

    const coffee = coffeeStateOf(this.coffeeAnswer, coffeeValidAfter);
    this.days.set(day.localDate, { alarmAt: day.alarmAt, status: "started", coffee, steps: {} });
    this.coffeeAnswer = null;
    return { kind: "reserved", coffee };
  }

  async recordWakeStep(localDate: string, step: WakeStep, outcome: StepOutcome): Promise<void> {
    const day = this.days.get(localDate);
    if (day) day.steps[step] = outcome;
  }

  async finishWake(localDate: string): Promise<void> {
    const day = this.days.get(localDate);
    if (day) day.status = "done";
  }
}
