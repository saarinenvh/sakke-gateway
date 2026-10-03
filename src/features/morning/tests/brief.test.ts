import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { reloadConfig } from "../../../config.js";
import type { EntityState } from "../../../integrations/homeAssistant/client.js";
import { FakeMorningStore } from "./fakeMorningStore.js";
import { runBriefTick, type BriefDeps } from "../brief.js";
import { STRUCTURE_HINTS } from "../prompts.js";

// The scheduled tick against a fake clock, fake HA states, a fake PC, a fake
// model and an in-memory store. All times and texts are made-up examples.

const PRESENCE = "device_tracker.phone";
const SATELLITE = "assist_satellite.living_room";
const WATCH = "sensor.watch_wake_time";
const ENV = {
  MORNING_ENABLED: "true",
  MORNING_PRESENCE_ENTITY_ID: PRESENCE,
  MORNING_WAKE_TIME_SENSOR: WATCH,
  ASSIST_SATELLITE_ENTITY_ID: SATELLITE,
  TZ: "Europe/Helsinki",
};

const at = (localIso: string) => new Date(`${localIso}:00+03:00`).getTime();
const MINUTE = 60_000;
const TODAY = "2026-10-05";
const ALARM = at("2026-10-05T07:30");

interface FakeWorld {
  deps: BriefDeps;
  store: FakeMorningStore;
  states: Map<string, EntityState>;
  setNow(at: number): void;
  setPcInput(at: number | null, fresh?: boolean): void;
  set(entityId: string, state: string): void;
  spoken: string[];
  requests: string[];
  failures: { speak?: Error; calendar?: Error; brief?: Error };
}

function fakeWorld(): FakeWorld {
  let now = ALARM + 20 * MINUTE;
  let pc = { lastInputAt: null as number | null, fresh: true };
  const states = new Map<string, EntityState>();
  const spoken: string[] = [];
  const requests: string[] = [];
  const failures: FakeWorld["failures"] = {};
  const store = new FakeMorningStore();
  const set = (entity_id: string, state: string) => states.set(entity_id, { entity_id, state, attributes: {} });
  set(PRESENCE, "home");
  set(SATELLITE, "idle");

  const deps: BriefDeps = {
    now: () => now,
    readState: async entityId => {
      const state = states.get(entityId);
      if (!state) throw new Error(`HA 404 on ${entityId}`);
      return state;
    },
    store,
    readPcInput: () => pc,
    readCalendar: async () => {
      if (failures.calendar) throw failures.calendar;
      return "Events (today): Dentist at 14:00.";
    },
    readTasks: async () => "Tasks (today): buy oat milk.",
    readWeather: async () => "Conditions: light rain\nTemperature: 9°C (feels like 6°C)\nWind: 12 km/h",
    writeBrief: async request => {
      requests.push(request);
      if (failures.brief) throw failures.brief;
      return "Look who's vertical. Dentist at two, oat milk on the list, and it's raining.";
    },
    speak: async text => {
      if (failures.speak) throw failures.speak;
      spoken.push(text);
    },
  };
  return {
    deps,
    store,
    states,
    setNow: t => { now = t; },
    setPcInput: (lastInputAt, fresh = true) => { pc = { lastInputAt, fresh }; },
    set,
    spoken,
    requests,
    failures,
  };
}

let world: FakeWorld;

async function wokeByAlarm(): Promise<void> {
  await world.store.reserveWake({ localDate: TODAY, alarmAt: ALARM, startedAt: ALARM }, 0);
}

beforeEach(() => {
  Object.assign(process.env, ENV);
  reloadConfig();
  world = fakeWorld();
});

afterAll(() => {
  for (const key of Object.keys(ENV)) delete process.env[key];
  reloadConfig();
});

describe("when the brief comes", () => {
  it("briefs once, on the first PC input after the alarm and the minimum delay", async () => {
    await wokeByAlarm();
    world.setPcInput(ALARM + 18 * MINUTE);

    const result = await runBriefTick(world.deps);

    expect(result).toEqual({ kind: "briefed", localDate: TODAY, wording: "generated", delivery: "delivered" });
    expect(world.spoken).toEqual(["Look who's vertical. Dentist at two, oat milk on the list, and it's raining."]);
    expect(world.store.briefs.get(TODAY)).toMatchObject({ startSource: "alarm", status: "delivered" });

    world.setNow(ALARM + 21 * MINUTE);
    expect(await runBriefTick(world.deps)).toEqual({ kind: "idle", reason: "already_briefed" });
    expect(world.spoken).toHaveLength(1);
  });

  it("doesn't count input inside the minimum delay", async () => {
    await wokeByAlarm();
    world.setNow(ALARM + 2 * MINUTE);
    world.setPcInput(ALARM + MINUTE);

    expect(await runBriefTick(world.deps)).toEqual({ kind: "idle", reason: "not_up_yet" });
    expect(world.spoken).toEqual([]);
  });

  it("starts the morning from the watch on a day without an alarm", async () => {
    world.set(WATCH, new Date(at("2026-10-05T08:10")).toISOString());
    world.setNow(at("2026-10-05T08:40"));
    world.setPcInput(at("2026-10-05T08:39"));

    expect((await runBriefTick(world.deps)).kind).toBe("briefed");
    expect(world.store.briefs.get(TODAY)?.startSource).toBe("watch");
    expect(world.requests[0]).toContain("watch says they woke at 08:10");
  });

  it("waits for today's alarm even when the watch says they woke before it", async () => {
    world.store.armedAlarmAt = ALARM;
    world.set(WATCH, new Date(at("2026-10-05T06:10")).toISOString());
    world.setNow(at("2026-10-05T06:40"));
    world.setPcInput(at("2026-10-05T06:39"));

    expect(await runBriefTick(world.deps)).toEqual({ kind: "idle", reason: "no_morning_start" });
    expect(world.spoken).toEqual([]);
  });

  it("waits while the watch still shows yesterday's wake time", async () => {
    world.set(WATCH, new Date(at("2026-10-04T08:10")).toISOString());
    world.setNow(at("2026-10-05T08:40"));
    world.setPcInput(at("2026-10-05T08:39"));

    expect(await runBriefTick(world.deps)).toEqual({ kind: "idle", reason: "no_morning_start" });
  });

  it("gives up at the cut-off", async () => {
    await wokeByAlarm();
    world.setNow(at("2026-10-05T12:00"));
    world.setPcInput(at("2026-10-05T11:59"));

    expect(await runBriefTick(world.deps)).toEqual({ kind: "idle", reason: "past_cutoff" });
  });

  it("waits while the PC's status is stale", async () => {
    await wokeByAlarm();
    world.setPcInput(ALARM + 18 * MINUTE, false);

    expect(await runBriefTick(world.deps)).toEqual({ kind: "idle", reason: "pc_status_unknown" });
  });
});

describe("guards", () => {
  beforeEach(async () => {
    await wokeByAlarm();
    world.setPcInput(ALARM + 18 * MINUTE);
  });

  it.each([
    [PRESENCE, "not_home", "not_home"],
    [SATELLITE, "unavailable", "satellite_unavailable"],
    [SATELLITE, "responding", "satellite_busy"],
  ] as const)("stays quiet when %s reads %s", async (entityId, state, reason) => {
    world.set(entityId, state);
    expect(await runBriefTick(world.deps)).toEqual({ kind: "skipped", reason });
    expect(world.spoken).toEqual([]);
    expect(world.store.briefs.size).toBe(0);
  });

  it("stays quiet when presence can't be read", async () => {
    world.states.delete(PRESENCE);
    expect(await runBriefTick(world.deps)).toEqual({ kind: "skipped", reason: "presence_unknown" });
  });

  it("checks again before speaking, so a satellite that got busy meanwhile isn't talked over", async () => {
    world.deps.writeBrief = async () => {
      world.set(SATELLITE, "listening");
      return "Up already?";
    };
    expect(await runBriefTick(world.deps)).toEqual({ kind: "skipped", reason: "satellite_busy" });
    expect(world.store.briefs.size).toBe(0);
  });

  it("reports a spoken brief as uncertain when recording its delivery fails, and doesn't repeat it", async () => {
    world.deps.store.markBriefDelivered = async () => { throw new Error("Connection lost"); };

    expect(await runBriefTick(world.deps)).toMatchObject({ kind: "briefed", delivery: "uncertain" });
    expect(world.spoken).toHaveLength(1);
    expect(await runBriefTick(world.deps)).toEqual({ kind: "idle", reason: "already_briefed" });
  });

  it("keeps the reservation when speaking times out, so the day is never briefed twice", async () => {
    world.failures.speak = new Error("no response within 15000 ms");

    expect(await runBriefTick(world.deps)).toEqual({ kind: "briefed", localDate: TODAY, wording: "generated", delivery: "uncertain" });
    world.failures.speak = undefined;
    expect(await runBriefTick(world.deps)).toEqual({ kind: "idle", reason: "already_briefed" });
    expect(world.spoken).toEqual([]);
  });
});

describe("the words", () => {
  beforeEach(async () => {
    await wokeByAlarm();
    world.setPcInput(ALARM + 18 * MINUTE);
  });

  it("gives the model the day's facts, a structure hint, and yesterday's brief to avoid", async () => {
    world.store.briefs.set("2026-10-04", {
      localDate: "2026-10-04", morningStartAt: ALARM - 86_400_000, startSource: "alarm",
      text: "Well, well, the sleeper wakes.", reservedAt: ALARM - 86_400_000, status: "delivered",
    });

    await runBriefTick(world.deps);

    const request = world.requests[0];
    expect(request).toContain("alarm rang at 07:30");
    expect(request).toContain("Dentist at 14:00");
    expect(request).toContain("buy oat milk");
    expect(request).toContain("light rain");
    expect(request).toContain('Yesterday you said: "Well, well, the sleeper wakes."');
    expect(STRUCTURE_HINTS.some(hint => request.includes(hint))).toBe(true);
  });

  it("falls back to a plain summary when the model fails", async () => {
    world.failures.brief = new Error("Ollama timed out");

    expect(await runBriefTick(world.deps)).toMatchObject({ wording: "fallback", delivery: "delivered" });
    expect(world.spoken).toEqual(["Good, you're up. Events (today): Dentist at 14:00. Tasks (today): buy oat milk. Conditions: light rain, Temperature: 9°C (feels like 6°C)."]);
  });

  it("still briefs when one source can't be read, and says so", async () => {
    world.failures.calendar = new Error("HA 500");
    await runBriefTick(world.deps);
    expect(world.requests[0]).toContain("The calendar couldn't be read.");
    expect(world.spoken).toHaveLength(1);
  });
});
