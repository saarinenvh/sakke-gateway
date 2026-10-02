import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { reloadConfig } from "../../config.js";
import type { EntityState } from "../../integrations/homeAssistant/client.js";
import { FakeMorningStore } from "../../../tests/fixtures/fakeMorningStore.js";
import { runMorningTick, type MorningDeps } from "./coach.js";

// The scheduled tick against a fake clock, fake HA states, a fake model and an
// in-memory store. All times are made-up examples.

const ALARM_SENSOR = "sensor.phone_next_alarm";
const PRESENCE = "device_tracker.phone";
const WAKE_SCRIPT = "script.wake_lights";
const COFFEE = "switch.coffee";
const CLOCK = "com.google.android.deskclock";
const ENV = {
  MORNING_ENABLED: "true",
  MORNING_ALARM_SENSOR: ALARM_SENSOR,
  MORNING_PRESENCE_ENTITY_ID: PRESENCE,
  MORNING_WAKE_SCRIPT: WAKE_SCRIPT,
  MORNING_COFFEE_SWITCH: COFFEE,
  MORNING_PHONE_NOTIFY_SERVICE: "mobile_app_phone",
  TZ: "Europe/Helsinki",
};

const at = (localIso: string) => new Date(`${localIso}:00+03:00`).getTime();
const MINUTE = 60_000;
const ALARM = at("2026-10-05T07:30");
const NEXT_ALARM = at("2026-10-06T07:30");
const GOOD_NIGHT = at("2026-10-04T23:00");

interface FakeWorld {
  deps: MorningDeps;
  store: FakeMorningStore;
  setNow(at: number): void;
  setAlarm(at: number | null, appPackage?: string): void;
  setPresence(state: string): void;
  calls: string[];
  spoken: string[];
  failing: Set<string>;
  greeting: { text: string | Error };
}

function fakeWorld(): FakeWorld {
  let now = ALARM - 30 * MINUTE;
  const states = new Map<string, EntityState>();
  const calls: string[] = [];
  const spoken: string[] = [];
  const failing = new Set<string>();
  const greeting: FakeWorld["greeting"] = { text: "Morning. Coffee's on, the lights too. Up you get." };
  const store = new FakeMorningStore();

  const setAlarm = (alarmAt: number | null, appPackage = CLOCK) => {
    states.set(ALARM_SENSOR, alarmAt === null
      ? { entity_id: ALARM_SENSOR, state: "unavailable", attributes: {} }
      : { entity_id: ALARM_SENSOR, state: new Date(alarmAt).toISOString(), attributes: { Package: appPackage } });
  };
  const setPresence = (state: string) => states.set(PRESENCE, { entity_id: PRESENCE, state, attributes: {} });
  setAlarm(ALARM);
  setPresence("home");

  const act = (call: string) => {
    calls.push(call);
    if (failing.has(call)) throw new Error(`HA 500 on ${call}`);
  };

  const deps: MorningDeps = {
    now: () => now,
    readState: async entityId => {
      const state = states.get(entityId);
      if (!state) throw new Error(`HA 404 on ${entityId}`);
      return state;
    },
    store,
    runScript: async entityId => act(`script ${entityId}`),
    switchOn: async entityId => act(`switch ${entityId}`),
    writeGreeting: async () => {
      if (greeting.text instanceof Error) throw greeting.text;
      return greeting.text;
    },
    speakOnPhone: async text => {
      act("phone");
      spoken.push(text);
    },
  };
  return { deps, store, setNow: t => { now = t; }, setAlarm, setPresence, calls, spoken, failing, greeting };
}

let world: FakeWorld;

// Arms tonight's alarm the way the running gateway would: a tick before it rings.
async function armAlarm(): Promise<void> {
  world.setNow(ALARM - 30 * MINUTE);
  await runMorningTick(world.deps);
}

// The phone's sensor moves on to the next alarm once this one rings.
async function ringAt(time: number): Promise<ReturnType<typeof runMorningTick>> {
  world.setNow(time);
  world.setAlarm(NEXT_ALARM);
  return runMorningTick(world.deps);
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

describe("watching the alarm", () => {
  it("arms the next Clock alarm", async () => {
    await armAlarm();
    expect(world.store.armedAlarmAt).toBe(ALARM);
    expect(world.calls).toEqual([]);
  });

  it("does nothing when it is turned off", async () => {
    await world.store.saveArmedAlarm(ALARM);
    process.env.MORNING_ENABLED = "false";
    reloadConfig();
    expect(await ringAt(ALARM + MINUTE)).toEqual({ kind: "idle", reason: "disabled" });
    expect(world.calls).toEqual([]);
  });

  it("ignores another app's alarm", async () => {
    world.setAlarm(ALARM, "com.google.android.calendar");
    await armAlarm();
    expect(world.store.armedAlarmAt).toBeNull();
  });
});

describe("waking up", () => {
  beforeEach(async () => {
    await world.store.saveCoffeeAnswer(true, GOOD_NIGHT);
    await armAlarm();
  });

  it("wakes the house once, even though the sensor has already moved on to tomorrow", async () => {
    const result = await ringAt(ALARM + 20_000);

    expect(result).toEqual({
      kind: "woke",
      localDate: "2026-10-05",
      coffee: "loaded",
      steps: { lights: "done", coffeeMaker: "done", greeting: "done" },
    });
    expect(world.calls).toEqual([`script ${WAKE_SCRIPT}`, `switch ${COFFEE}`, "phone"]);
    expect(world.spoken).toEqual(["Morning. Coffee's on, the lights too. Up you get."]);
    expect(world.store.armedAlarmAt).toBe(NEXT_ALARM);
    expect(world.store.days.get("2026-10-05")?.status).toBe("done");
  });

  it("doesn't fire twice when a snooze sets the sensor to a few minutes later", async () => {
    world.setNow(ALARM + 20_000);
    world.setAlarm(ALARM + 9 * MINUTE); // the snooze
    await runMorningTick(world.deps);

    world.setNow(ALARM + 9 * MINUTE + 20_000);
    world.setAlarm(NEXT_ALARM);
    const second = await runMorningTick(world.deps);

    expect(second).toEqual({ kind: "idle", reason: "already_woken" });
    expect(world.calls.filter(call => call === "phone")).toHaveLength(1);
  });

  it("doesn't fire for an alarm turned off before it rang", async () => {
    world.setNow(ALARM - 10 * MINUTE);
    world.setAlarm(null);
    await runMorningTick(world.deps);

    expect(await ringAt(ALARM + MINUTE)).toEqual({ kind: "idle", reason: "no_alarm_due" });
    expect(world.calls).toEqual([]);
  });

  it("follows an alarm moved later before it rang", async () => {
    world.setNow(ALARM - 10 * MINUTE);
    world.setAlarm(ALARM + 15 * MINUTE);
    await runMorningTick(world.deps);

    // The old time passes; the sensor still shows the new one.
    world.setNow(ALARM + MINUTE);
    expect(await runMorningTick(world.deps)).toEqual({ kind: "idle", reason: "no_alarm_due" });
    expect((await ringAt(ALARM + 16 * MINUTE)).kind).toBe("woke");
  });

  it.each([
    ["not_home", "not_home"],
    ["unavailable", "not_home"],
  ] as const)("does nothing when presence reads %s", async (presence, reason) => {
    world.setPresence(presence);
    expect(await ringAt(ALARM + MINUTE)).toEqual({ kind: "skipped", reason });
    expect(world.calls).toEqual([]);
    expect(world.store.days.size).toBe(0);
    expect(world.store.armedAlarmAt).toBe(ALARM);
  });

  it("wakes the house if the owner shows up as home within the grace window", async () => {
    world.setPresence("not_home");
    await ringAt(ALARM + MINUTE);

    world.setPresence("home");
    expect((await ringAt(ALARM + 3 * MINUTE)).kind).toBe("woke");
  });

  it("lets the alarm go if the owner is still away when the grace window ends", async () => {
    world.setPresence("not_home");
    await ringAt(ALARM + MINUTE);

    expect(await ringAt(ALARM + 11 * MINUTE)).toEqual({ kind: "idle", reason: "no_alarm_due" });
    expect(world.store.armedAlarmAt).toBe(NEXT_ALARM);
    expect(world.calls).toEqual([]);
  });

  it("does nothing when presence can't be read", async () => {
    world.deps.readState = async entityId => {
      if (entityId === PRESENCE) throw new Error("HA unreachable");
      return { entity_id: entityId, state: new Date(NEXT_ALARM).toISOString(), attributes: { Package: CLOCK } };
    };
    expect(await ringAt(ALARM + MINUTE)).toEqual({ kind: "skipped", reason: "presence_unknown" });
    expect(world.calls).toEqual([]);
  });

  it("still wakes the house after a restart inside the grace window", async () => {
    // The armed alarm survives in the store; a fresh tick finds it due.
    expect((await ringAt(ALARM + 9 * MINUTE)).kind).toBe("woke");
  });

  it("lets the alarm go after a restart past the grace window", async () => {
    expect(await ringAt(ALARM + 11 * MINUTE)).toEqual({ kind: "idle", reason: "no_alarm_due" });
    expect(world.calls).toEqual([]);
    expect(world.store.armedAlarmAt).toBe(NEXT_ALARM);
  });

  it("never runs a day again once it is reserved, even if a step was interrupted", async () => {
    // A crash after the reservation, before the coffee: the day exists, unfinished.
    await world.store.reserveWake({ localDate: "2026-10-05", alarmAt: ALARM, startedAt: ALARM }, GOOD_NIGHT - 1);

    expect(await ringAt(ALARM + MINUTE)).toEqual({ kind: "idle", reason: "already_woken" });
    expect(world.calls).toEqual([]);
  });

  it("can't brew from an answer consumed by an interrupted wake-up, now or at a later alarm", async () => {
    await world.store.reserveWake({ localDate: "2026-10-05", alarmAt: ALARM, startedAt: ALARM }, GOOD_NIGHT - 1);
    await ringAt(ALARM + MINUTE);

    world.setNow(NEXT_ALARM - 30 * MINUTE);
    world.setAlarm(NEXT_ALARM);
    await runMorningTick(world.deps);
    const nextDay = await ringAt(NEXT_ALARM + MINUTE);

    expect(nextDay).toMatchObject({ kind: "woke", coffee: "unknown" });
    expect(world.calls).not.toContain(`switch ${COFFEE}`);
  });

  it("runs nothing when the reservation fails, keeps the coffee answer and retries", async () => {
    world.store.failNextReservation = true;

    expect(await ringAt(ALARM + MINUTE)).toEqual({ kind: "skipped", reason: "reservation_failed" });
    expect(world.calls).toEqual([]);
    expect(world.store.coffeeAnswer).toEqual({ loaded: true, answeredAt: GOOD_NIGHT });
    expect(world.store.armedAlarmAt).toBe(ALARM);

    expect((await ringAt(ALARM + 2 * MINUTE)).kind).toBe("woke");
  });

  it("carries on when a step fails, and doesn't claim the coffee is brewing", async () => {
    world.failing.add(`switch ${COFFEE}`);
    world.greeting.text = new Error("Ollama timed out");

    const result = await ringAt(ALARM + MINUTE);

    expect(result).toMatchObject({ steps: { lights: "done", coffeeMaker: "failed", greeting: "done" } });
    expect(world.spoken).toEqual(["Good morning. I couldn't start the coffee maker."]);
  });
});

describe("the coffee", () => {
  beforeEach(armAlarm);

  it.each([
    ["loaded", { loaded: true, answeredAt: GOOD_NIGHT }, true, "Good morning. The coffee is brewing."],
    ["not_loaded", { loaded: false, answeredAt: GOOD_NIGHT }, false, "Good morning. No coffee today, the maker wasn't loaded."],
    ["unknown", null, false, "Good morning. I didn't hear about the coffee last night, so it's off."],
    ["unknown", { loaded: true, answeredAt: ALARM - 19 * 60 * MINUTE }, false, "Good morning. I didn't hear about the coffee last night, so it's off."],
  ] as const)("is %s for %o, and only a valid loaded starts the maker", async (state, answer, brews, fallback) => {
    world.store.coffeeAnswer = answer;
    world.greeting.text = "";

    const result = await ringAt(ALARM + MINUTE);

    expect(result).toMatchObject({ kind: "woke", coffee: state });
    expect(world.calls.includes(`switch ${COFFEE}`)).toBe(brews);
    expect(world.spoken).toEqual([fallback]);
    expect(world.store.coffeeAnswer).toBeNull();
  });
});
