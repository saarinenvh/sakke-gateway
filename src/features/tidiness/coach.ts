import { config } from "../../config.js";
import type { EntityState } from "../../integrations/homeAssistant/client.js";
import { moduleLog } from "../../logger.js";
import { nextNag, observeVacuum, type NagDecision, type NoNagReason } from "./policy.js";
import { buildAnswerContext, buildNagRequest, type NagFacts } from "./prompts.js";
import { getTidinessState, recordClean, recordNag, setCleaningSince, updateNag } from "./store.js";
import { findVacuum } from "./vacuum.js";

// The tidiness coach's scheduled check: once a minute, notice finished
// vacuum runs, and ask about cleaning when the schedule says a nag is due and
// nothing says to stay quiet. Every outside effect goes through CoachDeps, so
// a tick can run in a test against a fake clock, fake HA and a fake model.

export interface CoachDeps {
  now(): number;
  /** Throws when the entity can't be read. */
  readState(entityId: string): Promise<EntityState>;
  /** The model's spoken question, written from the given request. */
  writeNag(request: string): Promise<string>;
  /** Speaks the question on the satellite and opens the mic for the answer. */
  startConversation(question: string, answerContext: string): Promise<void>;
}

export type SkipReason = "presence_unknown" | "not_home" | "satellite_unavailable" | "satellite_busy" | "no_longer_eligible";

export type TickResult =
  | { kind: "idle"; reason: "disabled" | NoNagReason }
  | { kind: "skipped"; reason: SkipReason }
  | { kind: "asked"; slot: string; delivery: "delivered" | "uncertain" | "failed" };

const HOME_STATE = "home";
const SATELLITE_IDLE_STATE = "idle";
const SATELLITE_UNAVAILABLE_STATES = new Set(["unavailable", "unknown"]);

export async function runCoachTick(deps: CoachDeps): Promise<TickResult> {
  await trackCleaningRun(deps);

  if (!config.tidiness.enabled) return { kind: "idle", reason: "disabled" };

  const decision = decideNag(deps.now());
  if (decision.kind === "none") return { kind: "idle", reason: decision.reason };

  const blocker = await findDeliveryBlocker(deps);
  if (blocker) return { kind: "skipped", reason: blocker };

  return askNag(decision, deps);
}

// --- Last-cleaned tracking --------------------------------------------------

async function trackCleaningRun(deps: CoachDeps): Promise<void> {
  const lookup = findVacuum();
  if (lookup.kind !== "found") return;

  let vacuumState: EntityState;
  try {
    vacuumState = await deps.readState(lookup.vacuum.entity_id);
  } catch {
    return; // HA unreachable: try again next tick, change nothing.
  }

  const observedAt = deps.now();
  const changedAt = vacuumState.last_changed ? Date.parse(vacuumState.last_changed) : undefined;
  const transition = observeVacuum(
    getTidinessState().cleaningSince,
    { state: vacuumState.state, changedAt: Number.isNaN(changedAt) ? undefined : changedAt, observedAt },
    config.tidiness.minRunMinutes * 60_000,
  );

  await setCleaningSince(transition.cleaningSince);

  const { event } = transition;
  if (event.kind !== "finished") return;

  const minutes = Math.round(event.durationMs / 60_000);
  if (!event.counted) {
    moduleLog().info({ minutes }, "Vacuum run too short to count as a clean");
    return;
  }
  await recordClean(event.finishedAt, "vacuum");
  moduleLog().info({ minutes }, "Vacuum run recorded as a clean");
}

// --- Nag ----------------------------------------------------------------------

function decideNag(now: number): NagDecision {
  const state = getTidinessState();
  return nextNag({
    now: new Date(now),
    timezone: config.timezone,
    lastCleanedAt: state.lastCleanedAt,
    snoozedUntil: state.snoozedUntil,
    nags: state.nags,
    askTimes: config.tidiness.askTimes,
  });
}

// Fail quiet: anything unknown about the room is a reason not to speak.
async function findDeliveryBlocker(deps: CoachDeps): Promise<SkipReason | undefined> {
  const presenceEntityId = config.tidiness.presenceEntityId;
  if (presenceEntityId === undefined) return "presence_unknown";

  const presence = await readStateOrUndefined(deps, presenceEntityId);
  if (!presence) return "presence_unknown";
  if (presence.state !== HOME_STATE) return "not_home";

  const satellite = await readStateOrUndefined(deps, config.ha.satelliteEntityId);
  if (!satellite || SATELLITE_UNAVAILABLE_STATES.has(satellite.state)) return "satellite_unavailable";
  if (satellite.state !== SATELLITE_IDLE_STATE) return "satellite_busy";

  return undefined;
}

async function askNag(decision: Extract<NagDecision, { kind: "due" }>, deps: CoachDeps): Promise<TickResult> {
  const facts: NagFacts = { daysSinceClean: decision.daysSinceClean, declines: decision.declines, tone: decision.tone };

  const question = await writeQuestion(facts, deps);
  if (!question) {
    // Recorded so the slot isn't retried every minute against a model that
    // keeps failing.
    await recordNag({ slot: decision.slot, askedAt: deps.now(), delivery: "failed" });
    return { kind: "asked", slot: decision.slot, delivery: "failed" };
  }

  // Generating can take a while; the owner may have left or started talking.
  if (!(await stillEligible(decision.slot, deps))) return { kind: "skipped", reason: "no_longer_eligible" };

  // Reserved before speaking: a crash or timeout mid-delivery leaves the slot
  // "uncertain", never free to be asked a second time.
  await recordNag({ slot: decision.slot, askedAt: deps.now(), delivery: "uncertain" });
  try {
    await deps.startConversation(question, buildAnswerContext(question, facts));
  } catch (err) {
    moduleLog().warn({ slot: decision.slot, err: err instanceof Error ? err.message : String(err) }, "Cleaning nag delivery uncertain");
    return { kind: "asked", slot: decision.slot, delivery: "uncertain" };
  }

  await updateNag(decision.slot, { delivery: "delivered" });
  moduleLog().info({ slot: decision.slot, tone: facts.tone, daysSinceClean: facts.daysSinceClean, question }, "Cleaning nag asked");
  return { kind: "asked", slot: decision.slot, delivery: "delivered" };
}

async function writeQuestion(facts: NagFacts, deps: CoachDeps): Promise<string | undefined> {
  try {
    const question = (await deps.writeNag(buildNagRequest(facts))).trim();
    return question === "" ? undefined : question;
  } catch (err) {
    moduleLog().warn({ err: err instanceof Error ? err.message : String(err) }, "Could not write cleaning nag");
    return undefined;
  }
}

async function stillEligible(slot: string, deps: CoachDeps): Promise<boolean> {
  const decision = decideNag(deps.now());
  if (decision.kind !== "due" || decision.slot !== slot) return false;
  return (await findDeliveryBlocker(deps)) === undefined;
}

async function readStateOrUndefined(deps: CoachDeps, entityId: string): Promise<EntityState | undefined> {
  try {
    return await deps.readState(entityId);
  } catch {
    return undefined;
  }
}

// --- Scheduling ---------------------------------------------------------------

const TICK_INTERVAL_MS = 60_000;

// Ticks never overlap: one that is waiting on the model simply makes the
// next one a no-op until it finishes.
export function startTidinessCoach(deps: CoachDeps): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await runCoachTick(deps);
      if (result.kind !== "idle") moduleLog().info({ result }, "Tidiness coach tick");
    } catch (err) {
      moduleLog().error({ err: err instanceof Error ? err.message : String(err) }, "Tidiness coach tick failed");
    } finally {
      running = false;
    }
  };

  void tick();
  setInterval(() => void tick(), TICK_INTERVAL_MS).unref();
}
