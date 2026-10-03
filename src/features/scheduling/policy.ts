import { addDays, localDate, localWallTimeToInstant } from "../../util/time.js";
import type { ScheduledJob } from "./db/ScheduledJob.entity.js";

export const MERIDIEMS = ["am", "pm", "unspecified"] as const;
export type Meridiem = (typeof MERIDIEMS)[number];

export const CLOCK_DAYS = ["today", "tomorrow"] as const;
export type ClockDay = (typeof CLOCK_DAYS)[number];

// A clock time as it was said: "at 4", "at 4 pm", "tomorrow at 7:30".
export interface ClockTime {
  hour: number;
  minute: number;
  meridiem: Meridiem;
  day?: ClockDay;
}

export type ClockTimeResolution =
  | { kind: "resolved"; runAt: Date; day: ClockDay }
  // An hour of 13-23 said with "am", or 0 with "pm".
  | { kind: "contradictory" }
  // "Today" at a time that has already passed.
  | { kind: "passed_today" };

// When a clock time happens next. Without am/pm, an hour of 1-12 is either of
// its readings (4 is 04:00 or 16:00), whichever comes first. Without a day, a
// time already passed today is tomorrow's.
export function resolveClockTime(time: ClockTime, now: Date, timezone: string): ClockTimeResolution {
  const hours = hoursOfDay(time.hour, time.meridiem);
  if (hours.length === 0) return { kind: "contradictory" };

  const today = localDate(now.getTime(), timezone);
  const at = (day: ClockDay): Date[] => {
    const date = day === "today" ? today : addDays(today, 1);
    return hours.map(hour => localWallTimeToInstant(date, hour, time.minute, timezone));
  };
  const upcomingToday = at("today").filter(instant => instant > now);

  if (time.day === "tomorrow") return { kind: "resolved", runAt: earliest(at("tomorrow")), day: "tomorrow" };
  if (upcomingToday.length > 0) return { kind: "resolved", runAt: earliest(upcomingToday), day: "today" };
  if (time.day === "today") return { kind: "passed_today" };
  return { kind: "resolved", runAt: earliest(at("tomorrow")), day: "tomorrow" };
}

// The 24-hour hours a spoken hour can mean; none when it contradicts itself.
function hoursOfDay(hour: number, meridiem: Meridiem): number[] {
  const isTwelveHour = hour >= 1 && hour <= 12;
  switch (meridiem) {
    case "am":
      if (hour === 12) return [0];
      return hour <= 11 ? [hour] : [];
    case "pm":
      if (!isTwelveHour) return hour >= 13 ? [hour] : [];
      return hour === 12 ? [12] : [hour + 12];
    case "unspecified":
      if (!isTwelveHour) return [hour];
      return hour === 12 ? [0, 12] : [hour, hour + 12];
  }
}

function earliest(instants: Date[]): Date {
  return instants.reduce((first, instant) => (instant < first ? instant : first));
}

// How late a clock-time job may still run after the gateway was down. A
// reminder to take the meat out is still useful ten minutes late; a duration
// timer ("in 10 minutes") that late is noise, so those are never run late.
export const CLOCK_TIME_GRACE_MS = 15 * 60 * 1000;

export type MissedJobDecision = "run" | "drop";

// What to do with a pending job found at startup whose time has come.
export function decideMissedJob(job: Pick<ScheduledJob, "source" | "runAt">, now: Date): MissedJobDecision {
  if (job.source === "in") return "drop";
  return now.getTime() - job.runAt.getTime() <= CLOCK_TIME_GRACE_MS ? "run" : "drop";
}
