import { config } from "../../config.js";
import type { EntityState } from "../../integrations/homeAssistant/client.js";
import { moduleLog } from "../../logger.js";
import { withTimeout } from "../../util/async.js";
import { localDate } from "../../util/time.js";
import type { MorningRepository } from "./morningRepository.js";
import { decideBrief, findMorningStart, pickForDay, type BriefDecision, type BriefWaitReason, type MorningStart } from "./policy.js";
import { buildBriefRequest, fallbackBrief, STRUCTURE_HINTS, type DayFacts } from "./prompts.js";

// Scheduled check: once the owner is up and at the PC, brief them on the day,
// on the satellite. All I/O goes through BriefDeps.

export type BriefStore = Pick<MorningRepository, "loadWakeAlarm" | "hasBrief" | "loadBriefText" | "reserveBrief" | "markBriefDelivered">;

export interface PcInput {
  lastInputAt: number | null;
  // The PC has pushed its status recently enough to trust lastInputAt.
  fresh: boolean;
}

export interface BriefDeps {
  now(): number;
  /** Throws when the entity can't be read. */
  readState(entityId: string): Promise<EntityState>;
  store: BriefStore;
  readPcInput(): PcInput;
  readCalendar(): Promise<string>;
  readTasks(): Promise<string>;
  readWeather(): Promise<string>;
  /** The model's spoken brief, written from the given request. */
  writeBrief(request: string): Promise<string>;
  /** Speaks already-worded text on the satellite. */
  speak(text: string): Promise<void>;
}

export type BriefSkipReason = "presence_unknown" | "not_home" | "satellite_unavailable" | "satellite_busy";

export type BriefTickResult =
  | { kind: "idle"; reason: "disabled" | "already_briefed" | BriefWaitReason }
  | { kind: "skipped"; reason: BriefSkipReason }
  | { kind: "briefed"; localDate: string; wording: "generated" | "fallback"; delivery: "delivered" | "uncertain" };

const HOME_STATE = "home";
const SATELLITE_IDLE_STATE = "idle";
const SATELLITE_UNAVAILABLE_STATES = new Set(["unavailable", "unknown"]);
const BRIEF_WORDING_TIMEOUT_MS = 20_000;

export async function runBriefTick(deps: BriefDeps): Promise<BriefTickResult> {
  if (!config.morning.enabled) return { kind: "idle", reason: "disabled" };

  const today = localDate(deps.now(), config.timezone);
  if (await deps.store.hasBrief(today)) return { kind: "idle", reason: "already_briefed" };

  const decision = await decide(today, deps);
  if (decision.kind === "wait") return { kind: "idle", reason: decision.reason };

  const blocker = await findBriefBlocker(deps);
  if (blocker) return { kind: "skipped", reason: blocker };

  return brief(today, decision.start, deps);
}

// --- Deciding -----------------------------------------------------------------

async function decide(today: string, deps: BriefDeps): Promise<BriefDecision> {
  const now = deps.now();
  const start = findMorningStart(today, await deps.store.loadWakeAlarm(today), await readWatchWokeAt(deps), now, config.timezone);
  const pc = deps.readPcInput();
  return decideBrief({
    now,
    timezone: config.timezone,
    cutoff: config.morning.briefCutoff,
    minDelayMs: config.morning.briefMinDelayMinutes * 60_000,
    start,
    lastInputAt: pc.lastInputAt,
    pcStatusFresh: pc.fresh,
  });
}

async function readWatchWokeAt(deps: BriefDeps): Promise<number | null> {
  const sensorEntityId = config.morning.wakeTimeSensorEntityId;
  if (sensorEntityId === undefined) return null;

  const sensor = await readStateOrUndefined(deps, sensorEntityId);
  const wokeAt = sensor ? Date.parse(sensor.state) : Number.NaN;
  return Number.isNaN(wokeAt) ? null : wokeAt;
}

// Fail quiet: anything unknown about the room is a reason not to speak.
async function findBriefBlocker(deps: BriefDeps): Promise<BriefSkipReason | undefined> {
  const presenceEntityId = config.morning.presenceEntityId;
  if (presenceEntityId === undefined) return "presence_unknown";

  const presence = await readStateOrUndefined(deps, presenceEntityId);
  if (!presence) return "presence_unknown";
  if (presence.state !== HOME_STATE) return "not_home";

  const satellite = await readStateOrUndefined(deps, config.ha.satelliteEntityId);
  if (!satellite || SATELLITE_UNAVAILABLE_STATES.has(satellite.state)) return "satellite_unavailable";
  if (satellite.state !== SATELLITE_IDLE_STATE) return "satellite_busy";
  return undefined;
}

// --- Briefing -----------------------------------------------------------------

async function brief(today: string, start: MorningStart, deps: BriefDeps): Promise<BriefTickResult> {
  const day = await gatherDay(deps);
  const { text, wording } = await writeBriefText(today, start, day, deps);

  // Gathering and writing take a while; the satellite may have become busy.
  const blocker = await findBriefBlocker(deps);
  if (blocker) return { kind: "skipped", reason: blocker };

  // Reserved before speaking, so a timeout can never lead to briefing twice.
  const reservation = await deps.store.reserveBrief({ localDate: today, morningStartAt: start.at, startSource: start.source, text, reservedAt: deps.now() });
  if (reservation.kind === "already_reserved") return { kind: "idle", reason: "already_briefed" };

  try {
    await deps.speak(text);
  } catch (err) {
    moduleLog().warn({ day: today, err: errorMessage(err) }, "Morning brief delivery uncertain");
    return { kind: "briefed", localDate: today, wording, delivery: "uncertain" };
  }

  await deps.store.markBriefDelivered(today, deps.now());
  moduleLog().info({ day: today, start: start.source, wording, text }, "Morning brief delivered");
  return { kind: "briefed", localDate: today, wording, delivery: "delivered" };
}

// Each source fails on its own; the brief says what it couldn't read.
async function gatherDay(deps: BriefDeps): Promise<DayFacts> {
  const [calendar, tasks, weather] = await Promise.all([
    readOrSay(deps.readCalendar, "The calendar couldn't be read."),
    readOrSay(deps.readTasks, "The task list couldn't be read."),
    readOrSay(deps.readWeather, "The weather couldn't be read."),
  ]);
  return { calendar, tasks, weather };
}

async function readOrSay(read: () => Promise<string>, unavailable: string): Promise<string> {
  try {
    return await read();
  } catch (err) {
    moduleLog().warn({ err: errorMessage(err) }, unavailable);
    return unavailable;
  }
}

async function writeBriefText(today: string, start: MorningStart, day: DayFacts, deps: BriefDeps): Promise<{ text: string; wording: "generated" | "fallback" }> {
  const request = buildBriefRequest({
    day,
    start,
    timezone: config.timezone,
    structureHint: pickForDay(today, STRUCTURE_HINTS),
    yesterdayBrief: await loadYesterdayBrief(today, deps),
  });
  try {
    const text = (await withTimeout(deps.writeBrief(request), BRIEF_WORDING_TIMEOUT_MS, "brief")).trim();
    if (text !== "") return { text, wording: "generated" };
  } catch (err) {
    moduleLog().warn({ err: errorMessage(err) }, "Could not write the morning brief, using the fallback");
  }
  return { text: fallbackBrief(day), wording: "fallback" };
}

async function loadYesterdayBrief(today: string, deps: BriefDeps): Promise<string | null> {
  const yesterday = localDate(Date.parse(`${today}T12:00:00Z`) - 86_400_000, "UTC");
  try {
    return await deps.store.loadBriefText(yesterday);
  } catch {
    return null;
  }
}

async function readStateOrUndefined(deps: BriefDeps, entityId: string): Promise<EntityState | undefined> {
  try {
    return await deps.readState(entityId);
  } catch {
    return undefined;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- Scheduling ---------------------------------------------------------------

// Bounds how long after sitting down the brief comes.
const TICK_INTERVAL_MS = 30_000;

// Ticks never overlap.
export function startMorningBrief(deps: BriefDeps): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await runBriefTick(deps);
      if (result.kind !== "idle") moduleLog().info({ result }, "Morning brief tick");
    } catch (err) {
      moduleLog().error({ err: errorMessage(err) }, "Morning brief tick failed");
    } finally {
      running = false;
    }
  };

  void tick();
  setInterval(() => void tick(), TICK_INTERVAL_MS).unref();
}
