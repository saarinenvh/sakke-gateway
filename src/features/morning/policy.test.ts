import { describe, it, expect } from "vitest";
import { coffeeNewsOf, coffeeStateOf, findDueAlarm, nextArmedAlarm, type AlarmReading } from "./policy.js";

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
