import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeHomeAssistant, type FakeHomeAssistant } from "../fixtures/fakeHomeAssistant.js";
import { FakeJobStore } from "../fixtures/fakeJobStore.js";
import { executeTool, isSchedulable, runScheduledCall } from "../../src/tools/registry.js";
import { startScheduler, stopScheduler } from "../../src/features/scheduling/scheduler.js";
import { setWordingWriter } from "../../src/features/announcements/announcer.js";
import type { ScheduledJob } from "../../src/features/scheduling/ScheduledJob.entity.js";
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
  setWordingWriter(async message => message);
  await startScheduler({
    store,
    runJob: job => runScheduledCall(job, log),
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

    const spoken = ha.serviceCalls().filter(call => call.service === "announce").map(call => call.data.message);
    expect(spoken).toContain("Time's up: the pasta.");
  });
});

describe("runScheduledCall", () => {
  const job = (tool: string, args: Record<string, unknown>): ScheduledJob => ({
    id: "abc123", runAt: START, source: "in", tool, args, label: "test",
    status: "pending", createdAt: START, finishedAt: null, result: null,
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
