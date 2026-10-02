import { describe, it, expect } from "vitest";
import { coffeeNewsOf, coffeeStateOf, decideBrief, findDueAlarm, findMorningStart, nextArmedAlarm, pickForDay, type AlarmReading } from "./policy.js";

const CLOCK = "com.google.android.deskclock";
const MINUTE = 60_000;
const ALARM = Date.parse("2026-10-05T04:30:00Z");
const GRACE = 10 * MINUTE;

const clockAlarm = (at: number): AlarmReading => ({ kind: "alarm", at, package: CLOCK });

describe("findDueAlarm", () => {
  it("is nothing before the armed alarm rings", () => {
    expect(findDueAlarm(ALARM, ALARM - 1, GRACE)).toBeNull();
  });

  it("is the armed alarm from the moment it rings to the end of the grace window", () => {
    expect(findDueAlarm(ALARM, ALARM, GRACE)).toBe(ALARM);
    expect(findDueAlarm(ALARM, ALARM + GRACE, GRACE)).toBe(ALARM);
  });

  it("lets an alarm go once the grace window has passed", () => {
    expect(findDueAlarm(ALARM, ALARM + GRACE + 1, GRACE)).toBeNull();
  });

  it("is nothing with no alarm armed", () => {
    expect(findDueAlarm(null, ALARM, GRACE)).toBeNull();
  });
});

describe("nextArmedAlarm", () => {
  const before = ALARM - 30 * MINUTE;

  it("arms a future Clock alarm", () => {
    expect(nextArmedAlarm(null, clockAlarm(ALARM), CLOCK, before)).toBe(ALARM);
  });

  it("follows an alarm moved before it rings", () => {
    expect(nextArmedAlarm(ALARM, clockAlarm(ALARM + 15 * MINUTE), CLOCK, before)).toBe(ALARM + 15 * MINUTE);
  });

  it("clears an alarm turned off before it rings", () => {
    expect(nextArmedAlarm(ALARM, { kind: "none" }, CLOCK, before)).toBeNull();
  });

  it("moves on to the next alarm once this one has rung", () => {
    const tomorrow = ALARM + 24 * 60 * MINUTE;
    expect(nextArmedAlarm(ALARM, clockAlarm(tomorrow), CLOCK, ALARM + MINUTE)).toBe(tomorrow);
  });

  it("never arms a time already past, so a sensor that hasn't moved on can't fire twice", () => {
    expect(nextArmedAlarm(ALARM, clockAlarm(ALARM), CLOCK, ALARM + MINUTE)).toBeNull();
  });

  it("keeps the armed alarm when the sensor can't be read", () => {
    expect(nextArmedAlarm(ALARM, { kind: "unreadable" }, CLOCK, before)).toBe(ALARM);
  });

  it("ignores another app's alarm", () => {
    const reminder: AlarmReading = { kind: "alarm", at: ALARM - 5 * MINUTE, package: "com.google.android.calendar" };
    expect(nextArmedAlarm(ALARM, reminder, CLOCK, before)).toBe(ALARM);
    expect(nextArmedAlarm(null, reminder, CLOCK, before)).toBeNull();
  });
});

describe("coffeeStateOf", () => {
  const now = ALARM;
  const validAfter = now - 18 * 60 * MINUTE;

  it("is loaded or not loaded for an answer inside the window", () => {
    expect(coffeeStateOf({ loaded: true, answeredAt: now - 8 * 60 * MINUTE }, validAfter)).toBe("loaded");
    expect(coffeeStateOf({ loaded: false, answeredAt: now - 8 * 60 * MINUTE }, validAfter)).toBe("not_loaded");
  });

  it("is unknown with no answer, and for an expired one - never a no", () => {
    expect(coffeeStateOf(null, validAfter)).toBe("unknown");
    expect(coffeeStateOf({ loaded: true, answeredAt: validAfter - 1 }, validAfter)).toBe("unknown");
  });
});

describe("coffeeNewsOf", () => {
  it("only says brewing when the coffee maker actually started", () => {
    expect(coffeeNewsOf("loaded", true)).toBe("brewing");
    expect(coffeeNewsOf("loaded", false)).toBe("failed_to_start");
    expect(coffeeNewsOf("not_loaded", false)).toBe("not_loaded");
    expect(coffeeNewsOf("unknown", false)).toBe("unknown");
  });
});

describe("findMorningStart", () => {
  const TZ = "Europe/Helsinki";
  const today = "2026-10-05";
  const alarm = Date.parse("2026-10-05T07:30:00+03:00");
  const watch = Date.parse("2026-10-05T08:10:00+03:00");
  const now = Date.parse("2026-10-05T09:00:00+03:00");

  const base = { today, wakeAlarmAt: null, armedAlarmAt: null, watchWokeAt: null, now, timezone: TZ };

  it("is the alarm on an alarm day, even if the watch says they woke earlier", () => {
    const earlierWatch = Date.parse("2026-10-05T06:40:00+03:00");
    expect(findMorningStart({ ...base, wakeAlarmAt: alarm, watchWokeAt: earlierWatch })).toEqual({ at: alarm, source: "alarm" });
  });

  it("hasn't started while today's alarm is still ahead, whatever the watch says", () => {
    const earlyWatch = Date.parse("2026-10-05T06:10:00+03:00");
    const before = Date.parse("2026-10-05T06:30:00+03:00");
    expect(findMorningStart({ ...base, armedAlarmAt: alarm, watchWokeAt: earlyWatch, now: before })).toBeNull();
  });

  it("is the watch's wake time on a day without an alarm", () => {
    expect(findMorningStart({ ...base, watchWokeAt: watch })).toEqual({ at: watch, source: "watch" });
  });

  it("uses the watch when the armed alarm is for another day", () => {
    const monday = Date.parse("2026-10-06T07:30:00+03:00");
    expect(findMorningStart({ ...base, armedAlarmAt: monday, watchWokeAt: watch })).toEqual({ at: watch, source: "watch" });
  });

  it("ignores a watch wake time from yesterday, before the watch has synced", () => {
    const yesterday = Date.parse("2026-10-04T08:10:00+03:00");
    expect(findMorningStart({ ...base, watchWokeAt: yesterday })).toBeNull();
  });
});

describe("decideBrief", () => {
  const TZ = "Europe/Helsinki";
  const start = { at: Date.parse("2026-10-05T07:30:00+03:00"), source: "alarm" as const };
  const base = {
    now: Date.parse("2026-10-05T07:45:00+03:00"),
    timezone: TZ,
    cutoff: { hour: 12, minute: 0 },
    minDelayMs: 5 * MINUTE,
    start,
    lastInputAt: Date.parse("2026-10-05T07:44:00+03:00"),
    pcStatusFresh: true,
  };

  it("is due on PC input after the minimum delay", () => {
    expect(decideBrief(base)).toEqual({ kind: "due", start });
  });

  it("waits for input inside the minimum delay or before the start", () => {
    expect(decideBrief({ ...base, lastInputAt: Date.parse("2026-10-05T07:31:00+03:00") })).toEqual({ kind: "wait", reason: "not_up_yet" });
    expect(decideBrief({ ...base, lastInputAt: Date.parse("2026-10-05T06:59:00+03:00") })).toEqual({ kind: "wait", reason: "not_up_yet" });
    expect(decideBrief({ ...base, lastInputAt: null })).toEqual({ kind: "wait", reason: "not_up_yet" });
  });

  it("gives up at the cut-off", () => {
    expect(decideBrief({ ...base, now: Date.parse("2026-10-05T12:00:00+03:00") })).toEqual({ kind: "wait", reason: "past_cutoff" });
  });

  it("waits without a morning start, or with a stale PC status", () => {
    expect(decideBrief({ ...base, start: null })).toEqual({ kind: "wait", reason: "no_morning_start" });
    expect(decideBrief({ ...base, pcStatusFresh: false })).toEqual({ kind: "wait", reason: "pc_status_unknown" });
  });
});

describe("pickForDay", () => {
  it("never gives two consecutive days the same choice", () => {
    const choices = ["a", "b", "c"] as const;
    const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map(day => pickForDay(day, choices));
    for (let i = 1; i < days.length; i++) expect(days[i]).not.toBe(days[i - 1]);
  });
});
