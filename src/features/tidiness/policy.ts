import type { LocalTime } from "../../config.js";
import type { StateChange } from "../../integrations/homeAssistant/client.js";
import { localDate, localMinuteOfDay } from "../../util/time.js";

// Pure rules: every input, including "now", is passed in.

// --- Schedule -------------------------------------------------------------

// Owner-set schedule, in whole local days since the last clean.
const FIRST_ASK_DAY = 7;
const GRACE_DAY = 8;
const TWICE_DAILY_FROM_DAY = 10;

// A missed ask passes unasked rather than arriving late.
export const SLOT_WINDOW_MINUTES = 60;

export function asksForDay(daysSinceClean: number): number {
  if (daysSinceClean < FIRST_ASK_DAY || daysSinceClean === GRACE_DAY) return 0;
  return daysSinceClean >= TWICE_DAILY_FROM_DAY ? 2 : 1;
}

// --- Tone -----------------------------------------------------------------

export const TONE_LEVELS = [1, 2, 3, 4, 5] as const;
export type ToneLevel = (typeof TONE_LEVELS)[number];

// The day each tone level starts from, sharpest first. Below all of them: 1.
const TONE_THRESHOLDS: { fromDay: number; tone: ToneLevel }[] = [
  { fromDay: 14, tone: 5 },
  { fromDay: 12, tone: 4 },
  { fromDay: 10, tone: 3 },
  { fromDay: 9, tone: 2 },
];

// Meaner with the days, and one step per "no" since the last clean.
export function toneLevel(daysSinceClean: number, declines: number): ToneLevel {
  return clampTone(baseTone(daysSinceClean) + declines);
}

function baseTone(daysSinceClean: number): ToneLevel {
  for (const threshold of TONE_THRESHOLDS) {
    if (daysSinceClean >= threshold.fromDay) return threshold.tone;
  }
  return 1;
}

function clampTone(level: number): ToneLevel {
  const clamped = Math.min(Math.max(Math.round(level), 1), 5);
  return TONE_LEVELS[clamped - 1];
}

// --- Nag decision ---------------------------------------------------------

export type NagDelivery = "delivered" | "uncertain" | "failed";

export interface NagRecord {
  // "<local date>#<slot index>", e.g. "2026-10-04#1" - one ask per slot, ever.
  slot: string;
  askedAt: number;
  delivery: NagDelivery;
  answer?: "yes" | "no";
}

export interface NagInput {
  now: Date;
  timezone: string;
  lastCleanedAt: number | undefined;
  snoozedUntil: number | undefined;
  nags: NagRecord[];
  askTimes: LocalTime[];
}

export type NoNagReason = "never_cleaned" | "snoozed" | "not_due_today" | "no_slot_open" | "already_asked";

export type NagDecision =
  | { kind: "none"; reason: NoNagReason }
  | { kind: "due"; slot: string; daysSinceClean: number; declines: number; tone: ToneLevel };

export function nextNag(input: NagInput): NagDecision {
  // Unknown is not a dirty house.
  if (input.lastCleanedAt === undefined) return { kind: "none", reason: "never_cleaned" };
  if (input.snoozedUntil !== undefined && input.now.getTime() < input.snoozedUntil) {
    return { kind: "none", reason: "snoozed" };
  }

  const daysSinceClean = localDaysBetween(input.lastCleanedAt, input.now.getTime(), input.timezone);
  const askTimes = input.askTimes.slice(0, asksForDay(daysSinceClean));
  if (askTimes.length === 0) return { kind: "none", reason: "not_due_today" };

  const slotIndex = openSlotIndex(askTimes, localMinuteOfDay(input.now, input.timezone));
  if (slotIndex === undefined) return { kind: "none", reason: "no_slot_open" };

  const slot = `${localDate(input.now.getTime(), input.timezone)}#${slotIndex}`;
  if (input.nags.some(nag => nag.slot === slot)) return { kind: "none", reason: "already_asked" };

  const declines = countDeclinesSince(input.nags, input.lastCleanedAt);
  return { kind: "due", slot, daysSinceClean, declines, tone: toneLevel(daysSinceClean, declines) };
}

function openSlotIndex(askTimes: LocalTime[], minuteOfDay: number): number | undefined {
  for (const [index, time] of askTimes.entries()) {
    const start = time.hour * 60 + time.minute;
    if (minuteOfDay >= start && minuteOfDay < start + SLOT_WINDOW_MINUTES) return index;
  }
  return undefined;
}

export function countDeclinesSince(nags: NagRecord[], since: number): number {
  return nags.filter(nag => nag.askedAt >= since && nag.answer === "no").length;
}

// An answer only counts for a nag asked moments ago.
export const ANSWER_WINDOW_MINUTES = 15;

export function findAnswerableNag(nags: NagRecord[], now: number): NagRecord | undefined {
  const latest = nags.at(-1);
  if (!latest || latest.answer !== undefined || latest.delivery === "failed") return undefined;
  return now - latest.askedAt <= ANSWER_WINDOW_MINUTES * 60_000 ? latest : undefined;
}

// --- Cleaning runs --------------------------------------------------------

const CLEANING_STATE = "cleaning";
// A dropped connection, not the end of a run.
const INDETERMINATE_STATES = new Set(["unavailable", "unknown"]);

export interface VacuumObservation {
  state: string;
  // When HA says the state last changed; falls back to observedAt.
  changedAt: number | undefined;
  observedAt: number;
}

export type RunEvent =
  | { kind: "none" }
  | { kind: "started"; since: number }
  // estimatedStart is when a check first saw the run; the real start can be
  // earlier - see runStartFromHistory.
  | { kind: "finished"; finishedAt: number; estimatedStart: number };

export interface RunTransition {
  cleaningSince: number | undefined;
  event: RunEvent;
}

export function observeVacuum(cleaningSince: number | undefined, observation: VacuumObservation): RunTransition {
  if (INDETERMINATE_STATES.has(observation.state)) return { cleaningSince, event: { kind: "none" } };

  const changedAt = observation.changedAt ?? observation.observedAt;

  if (observation.state === CLEANING_STATE) {
    if (cleaningSince !== undefined) return { cleaningSince, event: { kind: "none" } };
    return { cleaningSince: changedAt, event: { kind: "started", since: changedAt } };
  }

  if (cleaningSince === undefined) return { cleaningSince, event: { kind: "none" } };

  return {
    cleaningSince: undefined,
    event: { kind: "finished", finishedAt: changedAt, estimatedStart: cleaningSince },
  };
}

// Walks back from the end of a run through cleaning and connection blips to
// where it really began. A blip resets HA's last_changed, so without this a
// long run could measure short.
export function runStartFromHistory(history: StateChange[], finishedAt: number): number | undefined {
  let start: number | undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const change = history[i];
    if (change.changedAt >= finishedAt) continue;
    if (change.state === CLEANING_STATE) {
      start = change.changedAt;
    } else if (!INDETERMINATE_STATES.has(change.state)) {
      break;
    }
  }
  return start;
}


// --- Local calendar -------------------------------------------------------

// Calendar days, compared as dates so DST can't shift the count.
export function localDaysBetween(from: number, to: number, timezone: string): number {
  const fromDay = Date.parse(localDate(from, timezone));
  const toDay = Date.parse(localDate(to, timezone));
  return Math.round((toDay - fromDay) / 86_400_000);
}
