import { describe, it, expect } from "vitest";
import { calendarEventsSchema } from "./schemas.js";

describe("calendarEventsSchema", () => {
  it("accepts timed and all-day events", () => {
    const events = [
      { summary: "Dentist", start: { dateTime: "2026-09-27T10:00:00+03:00" } },
      { summary: "Holiday", start: { date: "2026-09-28" } },
    ];
    expect(calendarEventsSchema.safeParse(events).success).toBe(true);
  });

  it.each([
    ["no start value at all", { summary: "x", start: {} }],
    ["an unparseable dateTime", { summary: "x", start: { dateTime: "tomorrow-ish" } }],
  ])("rejects an event with %s", (_case, event) => {
    expect(calendarEventsSchema.safeParse([event]).success).toBe(false);
  });
});
