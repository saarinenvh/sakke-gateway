// Pure rules for the morning wake-up: every input, including "now", is passed in.

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
