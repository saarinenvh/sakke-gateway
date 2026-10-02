import { config } from "../../config.js";
import type { EntityState } from "../../integrations/homeAssistant/client.js";
import { moduleLog } from "../../logger.js";
import { withTimeout } from "../../util/async.js";
import { localDate } from "../../util/time.js";
import type { StepOutcome } from "./MorningDay.entity.js";
import type { MorningRepository, WakeReservation, WakeStep } from "./morningRepository.js";
import { coffeeNewsOf, findDueAlarm, nextArmedAlarm, type AlarmReading, type CoffeeNews, type CoffeeState } from "./policy.js";
import { buildGreetingRequest, fallbackGreeting } from "./prompts.js";

// Scheduled check: watch the phone's alarm, and wake the house when it rings.
// All I/O goes through MorningDeps.

export type MorningStore = Pick<MorningRepository, "loadArmedAlarm" | "saveArmedAlarm" | "reserveWake" | "recordWakeStep" | "finishWake">;

export interface MorningDeps {
  now(): number;
  /** Throws when the entity can't be read. */
  readState(entityId: string): Promise<EntityState>;
  store: MorningStore;
  runScript(entityId: string): Promise<void>;
  switchOn(entityId: string): Promise<void>;
  /** The model's spoken greeting, written from the given request. */
  writeGreeting(request: string): Promise<string>;
  speakOnPhone(text: string): Promise<void>;
}

export type SkipReason = "presence_unknown" | "not_home" | "reservation_failed";

export interface WakeSteps {
  lights: StepOutcome;
  coffeeMaker: StepOutcome;
  greeting: StepOutcome;
}

export type TickResult =
  | { kind: "idle"; reason: "disabled" | "no_alarm_due" | "already_woken" }
  | { kind: "skipped"; reason: SkipReason }
  | { kind: "woke"; localDate: string; coffee: CoffeeState; steps: WakeSteps };

const HOME_STATE = "home";
const UNAVAILABLE_STATES = new Set(["unavailable", "unknown"]);
const ALARM_PACKAGE_ATTRIBUTE = "Package";
const GREETING_WORDING_TIMEOUT_MS = 15_000;

export async function runMorningTick(deps: MorningDeps): Promise<TickResult> {
  if (!config.morning.enabled) return { kind: "idle", reason: "disabled" };

  const armedAt = await deps.store.loadArmedAlarm();
  const dueAlarm = findDueAlarm(armedAt, deps.now(), config.morning.alarmGraceMinutes * 60_000);
  const result: TickResult = dueAlarm === null ? { kind: "idle", reason: "no_alarm_due" } : await wakeUp(dueAlarm, deps);

  // Kept armed, so the next tick retries while the grace window lasts: the
  // owner may show up as home a minute later, or the database come back.
  if (result.kind === "skipped") return result;

  await rearm(armedAt, deps);
  return result;
}

// --- Watching the alarm ---------------------------------------------------------

async function rearm(armedAt: number | null, deps: MorningDeps): Promise<void> {
  const reading = await readAlarm(deps);
  const nextAt = nextArmedAlarm(armedAt, reading, config.morning.alarmPackage, deps.now());
  if (nextAt === armedAt) return;

  await deps.store.saveArmedAlarm(nextAt);
  moduleLog().info({ armedAlarmAt: nextAt === null ? null : new Date(nextAt).toISOString() }, "Morning alarm armed");
}

async function readAlarm(deps: MorningDeps): Promise<AlarmReading> {
  const sensorEntityId = config.morning.alarmSensorEntityId;
  if (sensorEntityId === undefined) return { kind: "none" };

  const sensor = await readStateOrUndefined(deps, sensorEntityId);
  if (!sensor) return { kind: "unreadable" };
  if (UNAVAILABLE_STATES.has(sensor.state)) return { kind: "none" };

  const at = Date.parse(sensor.state);
  if (Number.isNaN(at)) return { kind: "none" };
  const appPackage = sensor.attributes[ALARM_PACKAGE_ATTRIBUTE];
  return { kind: "alarm", at, package: typeof appPackage === "string" ? appPackage : undefined };
}

// --- Waking the house -------------------------------------------------------------

async function wakeUp(alarmAt: number, deps: MorningDeps): Promise<TickResult> {
  const blocker = await findWakeBlocker(deps);
  if (blocker) return { kind: "skipped", reason: blocker };

  const day = localDate(alarmAt, config.timezone);
  const reservation = await reserveDay(day, alarmAt, deps);
  if (reservation === undefined) return { kind: "skipped", reason: "reservation_failed" };
  if (reservation.kind === "already_reserved") return { kind: "idle", reason: "already_woken" };

  const { coffee } = reservation;
  const lights = await runStep(day, "lights", deps, () => deps.runScript(config.morning.wakeScriptEntityId));
  const coffeeMaker = await startCoffee(day, coffee, deps);
  const greeting = await greetOnPhone(day, coffeeNewsOf(coffee, coffeeMaker === "done"), deps);
  await finishDay(day, deps);

  const steps: WakeSteps = { lights, coffeeMaker, greeting };
  moduleLog().info({ day, coffee, steps }, "Morning wake-up done");
  return { kind: "woke", localDate: day, coffee, steps };
}

// Fail quiet: anything unknown about whether the owner is home is a reason to do nothing.
async function findWakeBlocker(deps: MorningDeps): Promise<SkipReason | undefined> {
  const presenceEntityId = config.morning.presenceEntityId;
  if (presenceEntityId === undefined) return "presence_unknown";

  const presence = await readStateOrUndefined(deps, presenceEntityId);
  if (!presence) return "presence_unknown";
  if (presence.state !== HOME_STATE) return "not_home";
  return undefined;
}

async function reserveDay(day: string, alarmAt: number, deps: MorningDeps): Promise<WakeReservation | undefined> {
  const now = deps.now();
  try {
    return await deps.store.reserveWake(
      { localDate: day, alarmAt, startedAt: now },
      now - config.morning.coffeeAnswerHours * 3_600_000,
    );
  } catch (err) {
    moduleLog().warn({ day, err: errorMessage(err) }, "Could not reserve the morning wake-up, doing nothing");
    return undefined;
  }
}

async function startCoffee(day: string, coffee: CoffeeState, deps: MorningDeps): Promise<StepOutcome> {
  const switchEntityId = config.morning.coffeeSwitchEntityId;
  if (coffee !== "loaded" || switchEntityId === undefined) {
    await recordStep(day, "coffeeMaker", "skipped", deps);
    return "skipped";
  }
  return runStep(day, "coffeeMaker", deps, () => deps.switchOn(switchEntityId));
}

async function greetOnPhone(day: string, coffee: CoffeeNews, deps: MorningDeps): Promise<StepOutcome> {
  if (config.morning.phoneNotifyService === undefined) {
    await recordStep(day, "greeting", "skipped", deps);
    return "skipped";
  }
  return runStep(day, "greeting", deps, async () => deps.speakOnPhone(await writeGreeting(coffee, deps)));
}

async function writeGreeting(coffee: CoffeeNews, deps: MorningDeps): Promise<string> {
  try {
    const greeting = (await withTimeout(deps.writeGreeting(buildGreetingRequest(coffee)), GREETING_WORDING_TIMEOUT_MS, "greeting")).trim();
    if (greeting !== "") return greeting;
  } catch (err) {
    moduleLog().warn({ err: errorMessage(err) }, "Could not write the morning greeting, using the fallback");
  }
  return fallbackGreeting(coffee);
}

// A failed step is recorded and the wake-up carries on with the next one.
async function runStep(day: string, step: WakeStep, deps: MorningDeps, action: () => Promise<void>): Promise<StepOutcome> {
  let outcome: StepOutcome = "done";
  try {
    await action();
  } catch (err) {
    outcome = "failed";
    moduleLog().warn({ day, step, err: errorMessage(err) }, "Morning wake-up step failed");
  }
  await recordStep(day, step, outcome, deps);
  return outcome;
}

// The outcome is history; a failure to record it must not stop the wake-up.
async function recordStep(day: string, step: WakeStep, outcome: StepOutcome, deps: MorningDeps): Promise<void> {
  try {
    await deps.store.recordWakeStep(day, step, outcome);
  } catch (err) {
    moduleLog().warn({ day, step, outcome, err: errorMessage(err) }, "Could not record a morning wake-up step");
  }
}

async function finishDay(day: string, deps: MorningDeps): Promise<void> {
  try {
    await deps.store.finishWake(day, deps.now());
  } catch (err) {
    moduleLog().warn({ day, err: errorMessage(err) }, "Could not mark the morning wake-up done");
  }
}

async function readStateOrUndefined(deps: MorningDeps, entityId: string): Promise<EntityState | undefined> {
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

// Bounds how late after the alarm the house wakes.
const TICK_INTERVAL_MS = 30_000;

// Ticks never overlap.
export function startMorningCoach(deps: MorningDeps): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await runMorningTick(deps);
      if (result.kind !== "idle" || result.reason === "already_woken") moduleLog().info({ result }, "Morning tick");
    } catch (err) {
      moduleLog().error({ err: errorMessage(err) }, "Morning tick failed");
    } finally {
      running = false;
    }
  };

  void tick();
  setInterval(() => void tick(), TICK_INTERVAL_MS).unref();
}
