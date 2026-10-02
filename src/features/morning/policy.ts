import type { LocalTime } from "../../config.js";
import { localDate, localMinuteOfDay } from "../../util/time.js";
import type { MorningStartSource } from "./MorningBrief.entity.js";

// Pure rules for the morning wake-up and the day summary: every input,
// including "now", is passed in.

// --- The alarm ---------------------------------------------------------------

// What the phone's next-alarm sensor said on one read.
export type AlarmReading =
  | { kind: "unreadable" }
  | { kind: "none" }
  | { kind: "alarm"; at: number; package: string | undefined };

// The armed alarm when it has rung and is still within the grace window.
// Checked before the sensor is read, because the sensor moves on to the next
// alarm as soon as this one rings.
export function findDueAlarm(armedAt: number | null, now: number, graceMs: number): number | null {
  if (armedAt === null || now < armedAt || now - armedAt > graceMs) return null;
  return armedAt;
}

// The alarm to watch after this tick. Only a future alarm from the expected
// app is armed; a past one is either handled or let go.
export function nextArmedAlarm(armedAt: number | null, reading: AlarmReading, alarmPackage: string, now: number): number | null {
  const armedStillAhead = armedAt !== null && armedAt > now ? armedAt : null;
  switch (reading.kind) {
    case "unreadable":
      return armedAt;
    case "none":
      return null;
    case "alarm":
      // Another app's alarm says nothing about the Clock's, which may still be set.
      if (reading.package !== alarmPackage) return armedAt;
      return reading.at > now ? reading.at : armedStillAhead;
  }
}

// --- The coffee ----------------------------------------------------------------

export const COFFEE_STATES = ["loaded", "not_loaded", "unknown"] as const;
export type CoffeeState = (typeof COFFEE_STATES)[number];

export interface CoffeeAnswer {
  loaded: boolean;
  answeredAt: number;
}

// No answer, or one older than the window, is unknown: never a "no".
export function coffeeStateOf(answer: CoffeeAnswer | null, validAfter: number): CoffeeState {
  if (answer === null || answer.answeredAt < validAfter) return "unknown";
  return answer.loaded ? "loaded" : "not_loaded";
}

// --- The phone greeting ------------------------------------------------------

export type CoffeeNews = "brewing" | "failed_to_start" | "not_loaded" | "unknown";

export function coffeeNewsOf(coffee: CoffeeState, started: boolean): CoffeeNews {
  switch (coffee) {
    case "loaded":
      return started ? "brewing" : "failed_to_start";
    case "not_loaded":
      return "not_loaded";
    case "unknown":
      return "unknown";
  }
}

// --- The day summary ------------------------------------------------------------

export interface MorningStart {
  at: number;
  source: MorningStartSource;
}

// The alarm wake-up when there was one, else the watch's wake time once it
// reads today. An earlier watch time doesn't move an alarm day's start.
export function findMorningStart(today: string, alarmAt: number | null, watchWokeAt: number | null, now: number, timezone: string): MorningStart | null {
  if (alarmAt !== null) return { at: alarmAt, source: "alarm" };
  if (watchWokeAt !== null && watchWokeAt <= now && localDate(watchWokeAt, timezone) === today) return { at: watchWokeAt, source: "watch" };
  return null;
}

export interface BriefInput {
  now: number;
  timezone: string;
  cutoff: LocalTime;
  minDelayMs: number;
  start: MorningStart | null;
  lastInputAt: number | null;
  // The PC's status is current, so lastInputAt can be trusted.
  pcStatusFresh: boolean;
}

export type BriefWaitReason = "past_cutoff" | "no_morning_start" | "pc_status_unknown" | "not_up_yet";

export type BriefDecision = { kind: "due"; start: MorningStart } | { kind: "wait"; reason: BriefWaitReason };

// Due on the first PC input at least minDelayMs after the morning started,
// before the cut-off.
export function decideBrief(input: BriefInput): BriefDecision {
  if (localMinuteOfDay(new Date(input.now), input.timezone) >= input.cutoff.hour * 60 + input.cutoff.minute) {
    return { kind: "wait", reason: "past_cutoff" };
  }
  if (input.start === null) return { kind: "wait", reason: "no_morning_start" };
  if (!input.pcStatusFresh) return { kind: "wait", reason: "pc_status_unknown" };
  if (input.lastInputAt === null || input.lastInputAt < input.start.at + input.minDelayMs) return { kind: "wait", reason: "not_up_yet" };
  return { kind: "due", start: input.start };
}

// Consecutive days always get different entries.
export function pickForDay<T>(localDateString: string, choices: readonly T[]): T {
  const dayNumber = Math.round(Date.parse(localDateString) / 86_400_000);
  return choices[dayNumber % choices.length];
}
