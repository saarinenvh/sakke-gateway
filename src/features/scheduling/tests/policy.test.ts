import { describe, expect, it } from "vitest";
import { CLOCK_TIME_GRACE_MS, decideMissedJob, resolveClockTime, type ClockTime, type Meridiem } from "../policy.js";

const HELSINKI = "Europe/Helsinki";
// 12:00 in Helsinki (summer time, +3).
const NOON = "2026-09-29T09:00:00.000Z";
// 12:00 the day before each daylight saving change.
const NOON_BEFORE_AUTUMN_CHANGE = "2026-10-24T09:00:00.000Z";
const NOON_BEFORE_SPRING_CHANGE = "2027-03-27T10:00:00.000Z";

type Day = ClockTime["day"];

// [what, now, hour, minute, meridiem, day, expected: UTC instant + day, or a refusal]
const cases: [string, string, number, number, Meridiem, Day, string][] = [
  ["pm is the afternoon", NOON, 4, 0, "pm", undefined, "2026-09-29T13:00:00.000Z today"],
  ["am already passed rolls to tomorrow", NOON, 4, 0, "am", undefined, "2026-09-30T01:00:00.000Z tomorrow"],
  ["unspecified is the next upcoming reading", NOON, 4, 0, "unspecified", undefined, "2026-09-29T13:00:00.000Z today"],
  ["unspecified 11 is 23:00 once 11:00 has passed", NOON, 11, 0, "unspecified", undefined, "2026-09-29T20:00:00.000Z today"],
  ["minutes are kept", NOON, 4, 30, "pm", undefined, "2026-09-29T13:30:00.000Z today"],
  ["12 am is midnight", NOON, 12, 0, "am", undefined, "2026-09-29T21:00:00.000Z tomorrow"],
  ["12 pm is noon", NOON, 12, 0, "pm", "tomorrow", "2026-09-30T09:00:00.000Z tomorrow"],
  ["a 24-hour time is used as given", NOON, 16, 0, "unspecified", undefined, "2026-09-29T13:00:00.000Z today"],
  ["a 24-hour time with pm is the same time", NOON, 16, 0, "pm", undefined, "2026-09-29T13:00:00.000Z today"],
  ["hour 0 is midnight", NOON, 0, 0, "unspecified", undefined, "2026-09-29T21:00:00.000Z tomorrow"],
  ["13 or more with am contradicts itself", NOON, 16, 0, "am", undefined, "contradictory"],
  ["0 with pm contradicts itself", NOON, 0, 0, "pm", undefined, "contradictory"],
  ["today at a passed time is refused", NOON, 9, 0, "am", "today", "passed_today"],
  ["today takes the reading still to come", NOON, 9, 0, "unspecified", "today", "2026-09-29T18:00:00.000Z today"],
  ["tomorrow without am/pm is tomorrow's first reading", NOON, 4, 0, "unspecified", "tomorrow", "2026-09-30T01:00:00.000Z tomorrow"],
  ["a time that happens twice is its first occurrence", NOON_BEFORE_AUTUMN_CHANGE, 3, 30, "am", "tomorrow", "2026-10-25T00:30:00.000Z tomorrow"],
  ["a skipped time moves forward by the gap", NOON_BEFORE_SPRING_CHANGE, 3, 30, "am", "tomorrow", "2027-03-28T01:30:00.000Z tomorrow"],
];

describe("resolveClockTime", () => {
  it.each(cases)("%s", (_what, now, hour, minute, meridiem, day, expected) => {
    const time: ClockTime = { hour, minute, meridiem, ...(day ? { day } : {}) };
    const resolution = resolveClockTime(time, new Date(now), HELSINKI);
    const actual = resolution.kind === "resolved" ? `${resolution.runAt.toISOString()} ${resolution.day}` : resolution.kind;
    expect(actual).toBe(expected);
  });
});

describe("decideMissedJob", () => {
  const now = new Date(NOON);
  const dueAgo = (ms: number) => new Date(now.getTime() - ms);

  it("drops a duration job however little it missed", () => {
    expect(decideMissedJob({ source: "in", runAt: dueAgo(1_000) }, now)).toBe("drop");
  });

  it("runs a clock-time job up to the grace period late", () => {
    expect(decideMissedJob({ source: "at", runAt: dueAgo(CLOCK_TIME_GRACE_MS) }, now)).toBe("run");
  });

  it("drops a clock-time job missed by more than the grace period", () => {
    expect(decideMissedJob({ source: "at", runAt: dueAgo(CLOCK_TIME_GRACE_MS + 1) }, now)).toBe("drop");
  });
});
