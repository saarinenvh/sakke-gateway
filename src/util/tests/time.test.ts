import { describe, expect, it } from "vitest";
import { addDays, localTimeOfDay, localWallTimeToInstant } from "../time.js";

const HELSINKI = "Europe/Helsinki";

describe("localWallTimeToInstant", () => {
  // [what, local date, hour, minute, expected UTC instant]
  const cases: [string, string, number, number, string][] = [
    ["summer time (+3)", "2026-09-29", 16, 0, "2026-09-29T13:00:00.000Z"],
    ["winter time (+2)", "2026-12-01", 16, 0, "2026-12-01T14:00:00.000Z"],
    ["midnight", "2026-09-30", 0, 0, "2026-09-29T21:00:00.000Z"],
    ["the first occurrence of a time that happens twice (2026-10-25)", "2026-10-25", 3, 30, "2026-10-25T00:30:00.000Z"],
    ["just before the autumn change", "2026-10-25", 2, 59, "2026-10-24T23:59:00.000Z"],
    ["just after the autumn change", "2026-10-25", 4, 0, "2026-10-25T02:00:00.000Z"],
    ["a time skipped in spring, moved forward by the gap (03:30 -> 04:30)", "2027-03-28", 3, 30, "2027-03-28T01:30:00.000Z"],
    ["just after the spring change", "2027-03-28", 4, 0, "2027-03-28T01:00:00.000Z"],
  ];

  it.each(cases)("%s", (_what, date, hour, minute, expected) => {
    expect(localWallTimeToInstant(date, hour, minute, HELSINKI).toISOString()).toBe(expected);
  });

  // Far from UTC, the change happens on the previous UTC day.
  const otherZones: [string, string, string, number, number, string][] = [
    ["Auckland, a skipped time (02:30 -> 03:30)", "Pacific/Auckland", "2027-09-26", 2, 30, "2027-09-25T14:30:00.000Z"],
    ["Auckland, the first of a repeated time", "Pacific/Auckland", "2027-04-04", 2, 30, "2027-04-03T13:30:00.000Z"],
    ["New York, a skipped time (02:30 -> 03:30)", "America/New_York", "2027-03-14", 2, 30, "2027-03-14T07:30:00.000Z"],
    ["New York, the first of a repeated time", "America/New_York", "2026-11-01", 1, 30, "2026-11-01T05:30:00.000Z"],
  ];

  it.each(otherZones)("%s", (_what, timezone, date, hour, minute, expected) => {
    expect(localWallTimeToInstant(date, hour, minute, timezone).toISOString()).toBe(expected);
  });

  it("works for a timezone without daylight saving", () => {
    expect(localWallTimeToInstant("2026-10-25", 3, 30, "UTC").toISOString()).toBe("2026-10-25T03:30:00.000Z");
  });

  it("lands on the asked local time outside the changes", () => {
    const instant = localWallTimeToInstant("2026-10-25", 16, 45, HELSINKI);
    expect(localTimeOfDay(instant, HELSINKI)).toBe("16:45");
  });
});

describe("addDays", () => {
  it.each([
    ["2026-09-29", 1, "2026-09-30"],
    ["2026-09-30", 1, "2026-10-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-10-25", 1, "2026-10-26"],
  ] as const)("%s + %i day is %s", (from, days, expected) => {
    expect(addDays(from, days)).toBe(expected);
  });
});

describe("localTimeOfDay", () => {
  it("formats the local clock time as HH:MM", () => {
    expect(localTimeOfDay(new Date("2026-09-29T13:05:00.000Z"), HELSINKI)).toBe("16:05");
    expect(localTimeOfDay(new Date("2026-09-29T21:00:00.000Z"), HELSINKI)).toBe("00:00");
  });
});
