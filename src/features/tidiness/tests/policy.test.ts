import { describe, it, expect } from "vitest";
import {
  asksForDay,
  findAnswerableNag,
  localDaysBetween,
  nextNag,
  observeVacuum,
  runStartFromHistory,
  toneLevel,
  type NagInput,
  type NagRecord,
} from "../policy.js";

const TZ = "Europe/Helsinki";
const ASK_TIMES = [{ hour: 10, minute: 0 }, { hour: 18, minute: 0 }];
// Helsinki is UTC+3 until the end of October 2026.
const at = (localIso: string) => new Date(`${localIso}:00+03:00`);
const LAST_CLEANED = at("2026-10-01T12:00").getTime();

function input(now: Date, overrides: Partial<NagInput> = {}): NagInput {
  return { now, timezone: TZ, lastCleanedAt: LAST_CLEANED, snoozedUntil: undefined, nags: [], askTimes: ASK_TIMES, ...overrides };
}

const dayOf = (daysSinceClean: number, time: string) =>
  at(`2026-10-${String(1 + daysSinceClean).padStart(2, "0")}T${time}`);

describe("the owner's schedule", () => {
  it("asks on day 7, rests on day 8, asks on day 9, then twice a day from day 10", () => {
    const perDay = Array.from({ length: 15 }, (_, day) => asksForDay(day));
    expect(perDay).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 2, 2, 2, 2, 2]);
  });

  it("produces exactly the scheduled asks when a fake clock walks days 0-14", () => {
    const nags: NagRecord[] = [];
    const askedDays: number[] = [];

    for (let day = 0; day <= 14; day++) {
      for (const time of ["09:30", "10:05", "10:40", "14:00", "18:05", "18:30", "23:00"]) {
        const now = dayOf(day, time);
        const decision = nextNag(input(now, { nags }));
        if (decision.kind !== "due") continue;
        nags.push({ slot: decision.slot, askedAt: now.getTime(), delivery: "delivered" });
        askedDays.push(day);
      }
    }

    expect(askedDays).toEqual([7, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14]);
  });

  it("uses only the first ask time on a one-ask day", () => {
    expect(nextNag(input(dayOf(7, "18:05")))).toEqual({ kind: "none", reason: "no_slot_open" });
    expect(nextNag(input(dayOf(7, "10:05")))).toMatchObject({ kind: "due", slot: "2026-10-08#0" });
  });

  it("lets a slot pass unasked once its window closes, rather than asking late", () => {
    expect(nextNag(input(dayOf(10, "10:59")))).toMatchObject({ kind: "due" });
    expect(nextNag(input(dayOf(10, "11:00")))).toEqual({ kind: "none", reason: "no_slot_open" });
  });

  it("never asks twice in the same slot, whatever happened to the first ask", () => {
    const nags: NagRecord[] = [{ slot: "2026-10-11#0", askedAt: dayOf(10, "10:01").getTime(), delivery: "uncertain" }];
    expect(nextNag(input(dayOf(10, "10:30"), { nags }))).toEqual({ kind: "none", reason: "already_asked" });
  });

  it("stays quiet when no clean has ever been recorded", () => {
    expect(nextNag(input(dayOf(20, "10:05"), { lastCleanedAt: undefined }))).toEqual({ kind: "none", reason: "never_cleaned" });
  });

  it("stays quiet while snoozed, and resumes after", () => {
    const snoozedUntil = dayOf(10, "12:00").getTime();
    expect(nextNag(input(dayOf(10, "10:05"), { snoozedUntil }))).toEqual({ kind: "none", reason: "snoozed" });
    expect(nextNag(input(dayOf(10, "18:05"), { snoozedUntil }))).toMatchObject({ kind: "due" });
  });
});

describe("tone", () => {
  it("gets meaner the longer it has been", () => {
    expect([7, 9, 10, 12, 14, 30].map(day => toneLevel(day, 0))).toEqual([1, 2, 3, 4, 5, 5]);
  });

  it("gets one step meaner for every no since the last clean, capped at 5", () => {
    expect(toneLevel(9, 2)).toBe(4);
    expect(toneLevel(12, 5)).toBe(5);
  });

  it("counts only the no's since the last clean", () => {
    const nags: NagRecord[] = [
      { slot: "old", askedAt: LAST_CLEANED - 1, delivery: "delivered", answer: "no" },
      { slot: "2026-10-10#0", askedAt: dayOf(9, "10:01").getTime(), delivery: "delivered", answer: "no" },
    ];
    expect(nextNag(input(dayOf(10, "10:05"), { nags }))).toMatchObject({ kind: "due", declines: 1, tone: 4 });
  });
});

describe("answering a nag", () => {
  const asked = dayOf(10, "10:01").getTime();
  const nag: NagRecord = { slot: "2026-10-11#0", askedAt: asked, delivery: "delivered" };

  it("finds the latest unanswered nag asked a moment ago", () => {
    expect(findAnswerableNag([nag], asked + 60_000)).toBe(nag);
  });

  it("does not treat something said much later as an answer", () => {
    expect(findAnswerableNag([nag], asked + 60 * 60_000)).toBeUndefined();
  });

  it("ignores a nag that was already answered or never spoken", () => {
    expect(findAnswerableNag([{ ...nag, answer: "no" }], asked + 60_000)).toBeUndefined();
    expect(findAnswerableNag([{ ...nag, delivery: "failed" }], asked + 60_000)).toBeUndefined();
  });
});

describe("cleaning runs", () => {
  const start = at("2026-10-05T09:00").getTime();
  const min = (n: number) => start + n * 60_000;

  it("starts a run from when HA says cleaning began, not when it was noticed", () => {
    const result = observeVacuum(undefined, { state: "cleaning", changedAt: start, observedAt: start + 90_000 });
    expect(result).toEqual({ cleaningSince: start, event: { kind: "started", since: start } });
  });

  it("finishes the run when the vacuum leaves cleaning", () => {
    const result = observeVacuum(start, { state: "returning", changedAt: min(45), observedAt: min(47) });
    expect(result).toEqual({ cleaningSince: undefined, event: { kind: "finished", finishedAt: min(45), estimatedStart: start } });
  });

  it("treats a dropped connection as no change, not the end of a run", () => {
    const result = observeVacuum(start, { state: "unavailable", changedAt: min(1), observedAt: min(1) });
    expect(result).toEqual({ cleaningSince: start, event: { kind: "none" } });
  });

  it("falls back to the observation time when HA gives no change time", () => {
    const observedAt = start + 30_000;
    expect(observeVacuum(undefined, { state: "cleaning", changedAt: undefined, observedAt }).cleaningSince).toBe(observedAt);
  });
});

describe("the true start of a run", () => {
  const t = (minute: number) => at("2026-10-05T09:00").getTime() + minute * 60_000;

  it("reaches back across connection blips to where cleaning really began", () => {
    const history = [
      { state: "docked", changedAt: t(-30) },
      { state: "cleaning", changedAt: t(0) },
      { state: "unknown", changedAt: t(9) },
      { state: "cleaning", changedAt: t(9.1) },
      { state: "returning", changedAt: t(12) },
    ];
    expect(runStartFromHistory(history, t(12))).toBe(t(0));
  });

  it("stops at the previous run, not the one before it", () => {
    const history = [
      { state: "cleaning", changedAt: t(-60) },
      { state: "docked", changedAt: t(-20) },
      { state: "cleaning", changedAt: t(0) },
      { state: "returning", changedAt: t(15) },
    ];
    expect(runStartFromHistory(history, t(15))).toBe(t(0));
  });

  it("has nothing to say when history shows no cleaning", () => {
    expect(runStartFromHistory([{ state: "docked", changedAt: t(0) }], t(15))).toBeUndefined();
  });
});

describe("local days", () => {
  it("counts calendar days, so late last night is yesterday", () => {
    expect(localDaysBetween(at("2026-10-01T23:30").getTime(), at("2026-10-02T08:00").getTime(), TZ)).toBe(1);
  });

  it("is not thrown off by the end of summer time", () => {
    const before = new Date("2026-10-24T23:30:00+03:00").getTime();
    const after = new Date("2026-10-26T00:30:00+02:00").getTime();
    expect(localDaysBetween(before, after, TZ)).toBe(2);
  });
});
