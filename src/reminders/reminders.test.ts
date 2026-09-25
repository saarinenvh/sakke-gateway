import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { getDateRange, isDueInRange } from "./reminders.js";
import { reloadConfig } from "../config.js";

// getDateRange formats dates in config.timezone but takes the day-of-week from
// the process's own clock, so the two have to agree for the week boundaries to
// be right. They do in the container (compose sets TZ=Europe/Helsinki), and
// these tests hold them together deliberately rather than by luck.
const originalTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "Europe/Helsinki";
  reloadConfig();
});

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
  reloadConfig();
  vi.useRealTimers();
});

function at(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe("getDateRange", () => {
  it("today is a single day", () => {
    at("2026-09-25T12:00:00+03:00"); // Friday
    expect(getDateRange("today")).toEqual({ start: "2026-09-25", end: "2026-09-25" });
  });

  it("an unknown period falls back to today", () => {
    at("2026-09-25T12:00:00+03:00");
    expect(getDateRange("whenever")).toEqual({ start: "2026-09-25", end: "2026-09-25" });
  });

  it("tomorrow is a single day, and crosses the month correctly", () => {
    at("2026-09-30T12:00:00+03:00");
    expect(getDateRange("tomorrow")).toEqual({ start: "2026-10-01", end: "2026-10-01" });
  });

  it("this_week runs Monday to Sunday around a midweek day", () => {
    at("2026-09-23T12:00:00+03:00"); // Wednesday
    expect(getDateRange("this_week")).toEqual({ start: "2026-09-21", end: "2026-09-27" });
  });

  // getDay() returns 0 for Sunday, so both week branches special-case it. Get
  // that wrong and Sunday's "this week" starts six days in the future.
  it("this_week on a Sunday means the week that is ending, not the one starting", () => {
    at("2026-09-27T12:00:00+03:00"); // Sunday
    expect(getDateRange("this_week")).toEqual({ start: "2026-09-21", end: "2026-09-27" });
  });

  it("next_week runs the following Monday to Sunday", () => {
    at("2026-09-23T12:00:00+03:00"); // Wednesday
    expect(getDateRange("next_week")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
  });

  it("next_week on a Sunday is the week starting tomorrow", () => {
    at("2026-09-27T12:00:00+03:00"); // Sunday
    expect(getDateRange("next_week")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
  });

  it("next_week on a Monday is the week after this one", () => {
    at("2026-09-28T12:00:00+03:00"); // Monday
    expect(getDateRange("next_week")).toEqual({ start: "2026-10-05", end: "2026-10-11" });
  });
});

describe("isDueInRange", () => {
  const today = "2026-09-25";

  // Finding #15. A due value carrying a time is a longer string that sorts
  // after the plain date, so `due <= end` dropped it - silently, from the
  // morning briefing.
  it("counts a task due at a specific time today", () => {
    expect(isDueInRange("2026-09-25T10:00:00", today, today)).toBe(true);
  });

  it("counts a date-only task due today", () => {
    expect(isDueInRange("2026-09-25", today, today)).toBe(true);
  });

  it("counts an undated task, whatever the range", () => {
    expect(isDueInRange(undefined, today, today)).toBe(true);
  });

  it("excludes a task due tomorrow", () => {
    expect(isDueInRange("2026-09-26T09:00:00", today, today)).toBe(false);
  });

  it("excludes a task that was due yesterday", () => {
    expect(isDueInRange("2026-09-24T23:59:00", today, today)).toBe(false);
  });

  it("includes both ends of a multi-day range", () => {
    expect(isDueInRange("2026-09-21T08:00:00", "2026-09-21", "2026-09-27")).toBe(true);
    expect(isDueInRange("2026-09-27T23:00:00", "2026-09-21", "2026-09-27")).toBe(true);
  });
});
