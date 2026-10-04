import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeHomeAssistant, type FakeHomeAssistant } from "../fixtures/fakeHomeAssistant.js";
import { FakeJobStore } from "../fixtures/fakeJobStore.js";
import { executeTool, isSchedulable, runScheduledCall } from "../../src/tools/registry.js";
import { startScheduler, stopScheduler } from "../../src/features/scheduling/scheduler.js";
import { reportOutcome } from "../../src/features/scheduling/outcomeReport.js";
import { setWordingWriter } from "../../src/features/announcements/announcer.js";
import type { ScheduledJob } from "../../src/features/scheduling/db/ScheduledJob.entity.js";
import { config, reloadConfig } from "../../src/config.js";

// The schedule tool as the model uses it, on a scheduler over an in-memory
// store, with the real registry deciding what may run and running it.

// 12:00 in Helsinki.
const START = new Date("2026-09-29T09:00:00.000Z");
const MINUTE_MS = 60_000;

let ha: FakeHomeAssistant;
let store: FakeJobStore;
const log: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => log };

const schedule = (args: Record<string, unknown>) => executeTool("schedule", args, log, "schedule-test");
const setTimer = (minutes: number, label: string) => schedule({ action: "set", when: { in_minutes: minutes }, label });
const setAt = (at: Record<string, unknown>, label: string) => schedule({ action: "set", when: { at }, label });
// The fake keeps every call it has seen; each test looks only at its own.
let callsBeforeTest = 0;
const spokenOnSatellite = () => ha.serviceCalls().slice(callsBeforeTest)
  .filter(call => call.service === "announce").map(call => call.data.message);

beforeAll(async () => {
  ha = await startFakeHomeAssistant();
  process.env.HA_BASE_URL = ha.url;
  process.env.HA_TOKEN = "test-token";
  reloadConfig();
  config.timezone = "Europe/Helsinki";
});

afterAll(async () => {
  await ha.close();
  for (const key of ["HA_BASE_URL", "HA_TOKEN"]) delete process.env[key];
  reloadConfig();
});

beforeEach(async () => {
  // Timers and the clock only: Home Assistant requests keep their real
  // AbortSignal timeout.
  vi.useFakeTimers({ now: START, toFake: ["setTimeout", "clearTimeout", "Date"] });
  store = new FakeJobStore();
  callsBeforeTest = ha.serviceCalls().length;
  setWordingWriter(async message => message);
  await startScheduler({
    store,
    runJob: job => runScheduledCall(job, log),
    reportOutcome: (job, outcome) => reportOutcome(job, outcome, log),
    isSchedulable,
    now: () => new Date(),
    log,
  });
});

afterEach(() => {
  stopScheduler();
  vi.useRealTimers();
});

describe("setting", () => {
  it("stores an announcement of the label and says when it will happen", async () => {
    const reply = await setTimer(10, "the pasta");

    const [job] = store.all();
    expect(job).toMatchObject({
      runAt: new Date(START.getTime() + 10 * MINUTE_MS),
      source: "in",
      tool: "announce",
      args: { message: "Time's up: the pasta." },
      label: "the pasta",
      status: "pending",
    });
    expect(reply).toBe(`Scheduled for 12:10, in 10 minutes: the pasta. ID: ${job.id}.`);
  });

  it("takes a fraction of a minute", async () => {
    expect(await setTimer(0.5, "the eggs")).toMatch(/in 30 seconds: the eggs/);
  });

  it("describes a long wait in hours and minutes", async () => {
    expect(await setTimer(90, "the bread")).toMatch(/^Scheduled for 13:30, in 1 hour 30 minutes/);
  });

  it("refuses less than a second, storing nothing", async () => {
    expect(await setTimer(0.001, "nothing")).toMatch(/too soon/);
    expect(store.all()).toEqual([]);
  });

  it("refuses a missing, negative or absurdly long duration as invalid", async () => {
    expect(await setTimer(-5, "never")).toMatch(/^schedule failed/);
    expect(await setTimer(1e20, "never")).toMatch(/^schedule failed/);
    expect(await setTimer(367 * 24 * 60, "never")).toMatch(/^schedule failed/);
    expect(await schedule({ action: "set", label: "never" })).toMatch(/^schedule failed/);
    expect(store.all()).toEqual([]);
  });

  it("refuses a call the tool hasn't opted in to run unattended", async () => {
    const reply = await schedule({ action: "set", when: { in_minutes: 5 }, label: "weather", run: { tool: "get_weather", args: {} } });

    expect(reply).toBe("get_weather can't be scheduled.");
    expect(store.all()).toEqual([]);
  });
});

describe("listing and cancelling", () => {
  it("lists what is scheduled, soonest first", async () => {
    await setTimer(30, "the laundry");
    await setTimer(5, "the tea");

    const lines = (await schedule({ action: "list" })).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^[0-9a-f]{6}: "the tea" at 12:05, in 5 minutes$/);
    expect(lines[1]).toMatch(/"the laundry" at 12:30, in 30 minutes$/);
  });

  it("says when nothing is scheduled", async () => {
    expect(await schedule({ action: "list" })).toBe("Nothing is scheduled.");
    expect(await schedule({ action: "cancel" })).toBe("Nothing is scheduled.");
  });

  it("cancels the only job without being told which", async () => {
    await setTimer(10, "the pasta");

    expect(await schedule({ action: "cancel" })).toBe("Cancelled: the pasta.");
    expect(store.all()[0].status).toBe("cancelled");
  });

  it("cancels by part of the label", async () => {
    await setTimer(10, "food in the oven");
    await setTimer(20, "the tea");

    expect(await schedule({ action: "cancel", job_id: "oven" })).toBe("Cancelled: food in the oven.");
  });

  it("asks which one when several are scheduled", async () => {
    await setTimer(10, "the pasta");
    await setTimer(20, "the tea");

    expect(await schedule({ action: "cancel" })).toMatch(/^Several things are scheduled: .*the pasta.*the tea.*Say which one/);
    expect(store.all().every(job => job.status === "pending")).toBe(true);
  });

  it("says when nothing matches", async () => {
    await setTimer(10, "the pasta");
    expect(await schedule({ action: "cancel", job_id: "laundry" })).toBe("Nothing scheduled matches that.");
  });
});

describe("when the job is due", () => {
  it("announces it on the satellite and records it as done", async () => {
    await setTimer(1, "the pasta");

    await vi.advanceTimersByTimeAsync(MINUTE_MS);
    await vi.waitFor(() => expect(store.all()[0].status).toBe("done"), { timeout: 2_000 });

    expect(spokenOnSatellite()).toContain("Time's up: the pasta.");
  });
});

describe("clock times", () => {
  it("stores a clock-time job and says the resolved time back", async () => {
    const reply = await setAt({ hour: 4, meridiem: "pm" }, "take the meat out");

    const [job] = store.all();
    expect(job).toMatchObject({ runAt: new Date("2026-09-29T13:00:00.000Z"), source: "at", label: "take the meat out" });
    expect(reply).toBe(`Scheduled for 16:00 today: take the meat out. ID: ${job.id}.`);
  });

  it("says when a time has rolled over to tomorrow", async () => {
    expect(await setAt({ hour: 4, meridiem: "am" }, "the bread")).toMatch(/^Scheduled for 04:00 tomorrow: the bread\./);
  });

  it("refuses a time that contradicts itself, storing nothing", async () => {
    expect(await setAt({ hour: 16, meridiem: "am" }, "never")).toMatch(/contradicts itself/);
    expect(store.all()).toEqual([]);
  });

  it("refuses today at a time already passed, storing nothing", async () => {
    expect(await setAt({ hour: 9, meridiem: "am", day: "today" }, "never")).toBe("That time has already passed today. Nothing was scheduled.");
    expect(store.all()).toEqual([]);
  });

  it("lists a job due tomorrow as tomorrow", async () => {
    await setAt({ hour: 7, meridiem: "am" }, "the bread");
    expect(await schedule({ action: "list" })).toMatch(/"the bread" at 07:00 tomorrow, in 19 hours$/);
  });

  it("announces a clock-time job when it's due", async () => {
    await setAt({ hour: 12, minute: 30, meridiem: "pm" }, "the meat");

    await vi.advanceTimersByTimeAsync(30 * MINUTE_MS);
    await vi.waitFor(() => expect(store.all()[0].status).toBe("done"), { timeout: 2_000 });

    expect(spokenOnSatellite()).toContain("Time's up: the meat.");
  });
});

describe("scheduled actions", () => {
  const setRun = (label: string, run: Record<string, unknown>) =>
    schedule({ action: "set", when: { in_minutes: 1 }, label, run });
  // The outcome is stored first and spoken after, so wait for both: the
  // spoken lines arrive over real HTTP to the fake Home Assistant.
  const runDue = async (spokenLines: number) => {
    await vi.advanceTimersByTimeAsync(MINUTE_MS);
    await vi.waitFor(() => {
      expect(store.all().every(job => job.status !== "pending" && job.status !== "running")).toBe(true);
      expect(spokenOnSatellite()).toHaveLength(spokenLines);
    }, { timeout: 2_000 });
  };
  // Lets any request still on its way to the fake land, so a check that
  // something wasn't said can't pass just because it hasn't arrived yet.
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
  };

  it("makes the stored call when it's due, and says it was done in Sakke's words", async () => {
    setWordingWriter(async message => `Very good, sir. ${message}`);
    await setRun("good night", { tool: "run_routine", args: { script_id: "good_night" } });

    await runDue(1);

    expect(ha.serviceCalls().slice(callsBeforeTest)).toContainEqual({ domain: "script", service: "turn_on", data: { entity_id: "script.good_night" } });
    expect(store.all()[0].status).toBe("done");
    expect(spokenOnSatellite()).toEqual(["Very good, sir. It's 12:01: done as scheduled, good night. Routine \"good_night\" started."]);
  });

  it("says a scheduled action didn't work, and why", async () => {
    await setRun("lights off", { tool: "control_home_assistant", args: { action: "light_off", area: "nowhere" } });

    await runDue(1);

    expect(store.all()[0].status).toBe("failed");
    expect(spokenOnSatellite()).toEqual([expect.stringMatching(/^It's 12:01: the scheduled "lights off" didn't work\. No area named "nowhere" exists/)]);
  });

  it("speaks the outcome as written when the wording fails", async () => {
    setWordingWriter(async () => { throw new Error("ollama unreachable"); });
    await setRun("good night", { tool: "run_routine", args: { script_id: "good_night" } });

    await runDue(1);

    expect(spokenOnSatellite()).toEqual(["It's 12:01: done as scheduled, good night. Routine \"good_night\" started."]);
  });

  it("says a scheduled announcement once, with no report after it", async () => {
    await setTimer(1, "the pasta");

    await runDue(1);
    await settle();

    expect(spokenOnSatellite()).toEqual(["Time's up: the pasta."]);
  });

  it("refuses a call that can't run unattended, storing nothing", async () => {
    expect(await setRun("check", { tool: "vacuum", args: { action: "status" } })).toBe("vacuum can't be scheduled.");
    expect(store.all()).toEqual([]);
  });
});

describe("runScheduledCall", () => {
  const job = (tool: string, args: Record<string, unknown>, runAt = START): ScheduledJob => ({
    id: "abc123", runAt, source: "in", tool, args, label: "test",
    status: "pending", createdAt: START, finishedAt: null, result: null,
  });

  it("says an announcement is late when it runs well after its time", async () => {
    const dueTenMinutesAgo = new Date(START.getTime() - 10 * MINUTE_MS);

    await runScheduledCall(job("announce", { message: "Time's up: the meat." }, dueTenMinutesAgo), log);

    expect(spokenOnSatellite()).toEqual(["Time's up: the meat. (This was due at 11:50.)"]);
  });

  it("says nothing about lateness for the usual few seconds", async () => {
    const dueSecondsAgo = new Date(START.getTime() - 5_000);

    await runScheduledCall(job("announce", { message: "Time's up: the pasta." }, dueSecondsAgo), log);

    expect(spokenOnSatellite()).toEqual(["Time's up: the pasta."]);
  });

  it("refuses a stored call whose tool no longer runs unattended", async () => {
    expect(await runScheduledCall(job("get_weather", {}), log))
      .toEqual({ status: "failed", result: "get_weather can't be run by the scheduler" });
  });

  it("records a failing call as failed", async () => {
    expect(await runScheduledCall(job("announce", { message: "" }), log)).toMatchObject({ status: "failed" });
  });
});

describe("without the database", () => {
  it("says scheduling isn't available", async () => {
    stopScheduler();
    expect(await setTimer(10, "the pasta")).toBe("Scheduling isn't available right now.");
  });
});
