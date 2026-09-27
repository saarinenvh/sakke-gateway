import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { reloadConfig } from "../../config.js";
import type { EntityState } from "../../integrations/homeAssistant/client.js";
import { runCoachTick, type CoachDeps } from "./coach.js";
import { __resetTidinessState, getTidinessState, recordClean, restoreTidinessState } from "./store.js";

// The scheduled tick against a fake clock, fake HA states and a fake model.

const VACUUM = "vacuum.robot";
const PRESENCE = "person.owner";
const SATELLITE = "assist_satellite.sakke";
const ENV = {
  TIDINESS_ENABLED: "true",
  TIDINESS_VACUUM_ENTITY_ID: VACUUM,
  TIDINESS_PRESENCE_ENTITY_ID: PRESENCE,
  ASSIST_SATELLITE_ENTITY_ID: SATELLITE,
  TIDINESS_ASK_TIMES: "10:00,18:00",
  TZ: "Europe/Helsinki",
};

const at = (localIso: string) => new Date(`${localIso}:00+03:00`).getTime();
const CLEANED = at("2026-10-01T12:00");
const DAY_7_MORNING = at("2026-10-08T10:05");

interface FakeWorld {
  deps: CoachDeps;
  states: Map<string, EntityState>;
  spoken: { question: string; context: string }[];
  setNow(at: number): void;
}

function fakeWorld(): FakeWorld {
  let now = DAY_7_MORNING;
  const states = new Map<string, EntityState>();
  const spoken: FakeWorld["spoken"] = [];
  const set = (entity_id: string, state: string) => states.set(entity_id, { entity_id, state, attributes: {} });
  set(VACUUM, "docked");
  set(PRESENCE, "home");
  set(SATELLITE, "idle");

  const deps: CoachDeps = {
    now: () => now,
    readState: async entityId => {
      const state = states.get(entityId);
      if (!state) throw new Error(`HA 404 on ${entityId}`);
      return state;
    },
    writeNag: async () => "Shall I deal with the dust, or are you breeding it?",
    startConversation: async (question, context) => {
      spoken.push({ question, context });
    },
  };
  return { deps, states, spoken, setNow: t => { now = t; } };
}

let world: FakeWorld;

beforeEach(async () => {
  Object.assign(process.env, ENV, { STATE_DIR: mkdtempSync(join(tmpdir(), "sakke-tidiness-")) });
  reloadConfig();
  __resetTidinessState();
  world = fakeWorld();
  await recordClean(CLEANED, "vacuum");
});

afterAll(() => {
  for (const key of [...Object.keys(ENV), "STATE_DIR"]) delete process.env[key];
  reloadConfig();
});

describe("asking", () => {
  it("asks on day 7 with the question and the context for the answer", async () => {
    const result = await runCoachTick(world.deps);

    expect(result).toEqual({ kind: "asked", slot: "2026-10-08#0", delivery: "delivered" });
    expect(world.spoken).toHaveLength(1);
    expect(world.spoken[0].context).toContain(world.spoken[0].question);
    expect(world.spoken[0].context).toContain("7 days ago");
    expect(getTidinessState().nags).toEqual([{ slot: "2026-10-08#0", askedAt: DAY_7_MORNING, delivery: "delivered" }]);
  });

  it("does not ask twice in the same slot", async () => {
    await runCoachTick(world.deps);
    world.setNow(DAY_7_MORNING + 5 * 60_000);

    expect(await runCoachTick(world.deps)).toEqual({ kind: "idle", reason: "already_asked" });
    expect(world.spoken).toHaveLength(1);
  });

  it("remembers a used slot across a restart", async () => {
    await runCoachTick(world.deps);
    __resetTidinessState();
    await restoreTidinessState();
    world.setNow(DAY_7_MORNING + 5 * 60_000);

    expect(await runCoachTick(world.deps)).toEqual({ kind: "idle", reason: "already_asked" });
  });
});

describe("staying quiet", () => {
  it("says nothing when the owner is away, without even writing a nag", async () => {
    world.states.set(PRESENCE, { entity_id: PRESENCE, state: "not_home", attributes: {} });
    let wrote = false;
    world.deps.writeNag = async () => { wrote = true; return "?"; };

    expect(await runCoachTick(world.deps)).toEqual({ kind: "skipped", reason: "not_home" });
    expect(wrote).toBe(false);
    expect(getTidinessState().nags).toEqual([]);
  });

  it("treats unreadable presence as unknown, not as home", async () => {
    world.states.delete(PRESENCE);
    expect(await runCoachTick(world.deps)).toEqual({ kind: "skipped", reason: "presence_unknown" });
  });

  it("does not talk over a conversation already in progress", async () => {
    world.states.set(SATELLITE, { entity_id: SATELLITE, state: "listening", attributes: {} });
    expect(await runCoachTick(world.deps)).toEqual({ kind: "skipped", reason: "satellite_busy" });
  });

  it("does nothing when the satellite is unavailable", async () => {
    world.states.set(SATELLITE, { entity_id: SATELLITE, state: "unavailable", attributes: {} });
    expect(await runCoachTick(world.deps)).toEqual({ kind: "skipped", reason: "satellite_unavailable" });
  });

  it("does not speak when switched off", async () => {
    process.env.TIDINESS_ENABLED = "false";
    reloadConfig();
    expect(await runCoachTick(world.deps)).toEqual({ kind: "idle", reason: "disabled" });
    expect(world.spoken).toEqual([]);
  });

  it("drops the nag if the owner leaves while it is being written", async () => {
    world.deps.writeNag = async () => {
      world.states.set(PRESENCE, { entity_id: PRESENCE, state: "not_home", attributes: {} });
      return "Shall I?";
    };

    expect(await runCoachTick(world.deps)).toEqual({ kind: "skipped", reason: "no_longer_eligible" });
    expect(world.spoken).toEqual([]);
  });
});

describe("failures", () => {
  it("records an uncertain delivery and does not retry it", async () => {
    world.deps.startConversation = async () => { throw new Error("timeout"); };

    expect(await runCoachTick(world.deps)).toEqual({ kind: "asked", slot: "2026-10-08#0", delivery: "uncertain" });
    world.setNow(DAY_7_MORNING + 60_000);
    expect(await runCoachTick(world.deps)).toEqual({ kind: "idle", reason: "already_asked" });
  });

  it("gives up on the slot when the model can't write the nag", async () => {
    world.deps.writeNag = async () => { throw new Error("Ollama HTTP 500"); };

    expect(await runCoachTick(world.deps)).toEqual({ kind: "asked", slot: "2026-10-08#0", delivery: "failed" });
    world.setNow(DAY_7_MORNING + 60_000);
    expect(await runCoachTick(world.deps)).toEqual({ kind: "idle", reason: "already_asked" });
  });
});

describe("last-cleaned tracking", () => {
  it("records a clean when a long enough run ends, even with the nag switched off", async () => {
    process.env.TIDINESS_ENABLED = "false";
    reloadConfig();
    const start = at("2026-10-05T09:00");
    const end = at("2026-10-05T09:50");

    world.states.set(VACUUM, { entity_id: VACUUM, state: "cleaning", attributes: {}, last_changed: new Date(start).toISOString() });
    world.setNow(start + 60_000);
    await runCoachTick(world.deps);
    expect(getTidinessState().cleaningSince).toBe(start);

    world.states.set(VACUUM, { entity_id: VACUUM, state: "docked", attributes: {}, last_changed: new Date(end).toISOString() });
    world.setNow(end + 60_000);
    await runCoachTick(world.deps);

    expect(getTidinessState()).toMatchObject({ lastCleanedAt: end, lastCleanedBy: "vacuum", cleaningSince: undefined });
  });

  it("ignores a run too short to count", async () => {
    const start = at("2026-10-05T09:00");
    world.states.set(VACUUM, { entity_id: VACUUM, state: "cleaning", attributes: {}, last_changed: new Date(start).toISOString() });
    world.setNow(start + 60_000);
    await runCoachTick(world.deps);
    world.states.set(VACUUM, { entity_id: VACUUM, state: "docked", attributes: {}, last_changed: new Date(start + 120_000).toISOString() });
    world.setNow(start + 180_000);
    await runCoachTick(world.deps);

    expect(getTidinessState().lastCleanedAt).toBe(CLEANED);
  });
});
