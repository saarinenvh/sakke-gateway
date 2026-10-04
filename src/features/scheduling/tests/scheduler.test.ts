import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeJobStore } from "../../../../tests/fixtures/fakeJobStore.js";
import { Scheduler, type JobOutcome, type JobRequest, type JobRunner } from "../scheduler.js";
import type { ScheduledJob } from "../db/ScheduledJob.entity.js";
// Each tool declares whether it may run unattended; the test uses the same answer.
import { isSchedulable } from "../../../tools/registry.js";

const START = new Date("2026-09-29T09:00:00.000Z");
const MINUTE_MS = 60_000;

const log: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => log };

function inMinutes(minutes: number, label = "pasta"): JobRequest {
  return {
    runAt: new Date(Date.now() + minutes * MINUTE_MS),
    source: "in",
    tool: "announce",
    args: { message: `The timer for ${label} is done.` },
    label,
  };
}

let store: FakeJobStore;
let ran: ScheduledJob[];
// Each report, with the job's stored status at that moment.
let reported: { id: string; outcome: JobOutcome; storedStatus: string | undefined }[];
let nextOutcome: JobOutcome;

const runJob: JobRunner = async job => {
  ran.push(job);
  return nextOutcome;
};

function startScheduler(runner: JobRunner = runJob): Scheduler {
  return new Scheduler({
    store,
    runJob: runner,
    reportOutcome: async (job, outcome) => {
      reported.push({ id: job.id, outcome, storedStatus: store.get(job.id)?.status });
    },
    isSchedulable,
    now: () => new Date(),
    log,
  });
}

async function scheduleJob(scheduler: Scheduler, request: JobRequest): Promise<ScheduledJob> {
  const result = await scheduler.schedule(request);
  if (result.kind !== "scheduled") throw new Error(`not scheduled: ${result.tool}`);
  return result.job;
}

beforeEach(() => {
  vi.useFakeTimers({ now: START });
  store = new FakeJobStore();
  ran = [];
  reported = [];
  nextOutcome = { status: "done", result: "Announced." };
});

afterEach(() => vi.useRealTimers());

describe("running a job", () => {
  it("runs the stored call when it is due, not before", async () => {
    const scheduler = startScheduler();
    const job = await scheduleJob(scheduler, inMinutes(10));

    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS - 1);
    expect(ran).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(ran.map(j => [j.tool, j.args])).toEqual([["announce", { message: "The timer for pasta is done." }]]);
    expect(store.get(job.id)).toMatchObject({ status: "done", result: "Announced." });
  });

  it("records a failed call as failed, with the reason", async () => {
    nextOutcome = { status: "failed", result: "Home Assistant request timed out" };
    const scheduler = startScheduler();
    const job = await scheduleJob(scheduler, inMinutes(1));

    await vi.advanceTimersByTimeAsync(MINUTE_MS);

    expect(store.get(job.id)).toMatchObject({ status: "failed", result: "Home Assistant request timed out" });
  });

  it("records a runner that throws as failed rather than losing the job", async () => {
    const scheduler = startScheduler(async () => {
      throw new Error("registry exploded");
    });
    const job = await scheduleJob(scheduler, inMinutes(1));

    await vi.advanceTimersByTimeAsync(MINUTE_MS);

    expect(store.get(job.id)).toMatchObject({ status: "failed", result: "registry exploded" });
  });

  it("keeps a long result short in the history", async () => {
    nextOutcome = { status: "done", result: "x".repeat(5_000) };
    const scheduler = startScheduler();
    const job = await scheduleJob(scheduler, inMinutes(1));

    await vi.advanceTimersByTimeAsync(MINUTE_MS);

    expect(store.get(job.id)?.result).toHaveLength(1_000);
  });

  it("runs a job further out than setTimeout can wait, at its time", async () => {
    const thirtyDays = 30 * 24 * 60;
    const scheduler = startScheduler();
    await scheduleJob(scheduler, inMinutes(thirtyDays));

    await vi.advanceTimersByTimeAsync(thirtyDays * MINUTE_MS - MINUTE_MS);
    expect(ran).toEqual([]);

    await vi.advanceTimersByTimeAsync(MINUTE_MS);
    expect(ran).toHaveLength(1);
  });
});

describe("reporting the outcome", () => {
  it("reports how a job went once its outcome is stored", async () => {
    const scheduler = startScheduler();
    const job = await scheduleJob(scheduler, inMinutes(1));

    await vi.advanceTimersByTimeAsync(MINUTE_MS);

    expect(reported).toEqual([{ id: job.id, outcome: nextOutcome, storedStatus: "done" }]);
  });

  it("keeps the stored outcome when the report fails", async () => {
    const scheduler = new Scheduler({
      store,
      runJob,
      reportOutcome: async () => { throw new Error("satellite unreachable"); },
      isSchedulable,
      now: () => new Date(),
      log,
    });
    const job = await scheduleJob(scheduler, inMinutes(1));

    await vi.advanceTimersByTimeAsync(MINUTE_MS);

    expect(store.get(job.id)?.status).toBe("done");
  });

  it("reports nothing for a job it didn't run", async () => {
    const scheduler = startScheduler();
    await scheduleJob(scheduler, inMinutes(1));
    store.failNextWrite = true;

    await vi.advanceTimersByTimeAsync(MINUTE_MS);

    expect(reported).toEqual([]);
  });
});

describe("scheduling", () => {
  it("refuses a call that may not run unattended, and stores nothing", async () => {
    const scheduler = startScheduler();

    const result = await scheduler.schedule({ ...inMinutes(1), tool: "get_weather", args: {} });

    expect(result).toEqual({ kind: "not_schedulable", tool: "get_weather" });
    expect(store.all()).toEqual([]);
  });

  it("stores the job before arming it, so a failed write schedules nothing", async () => {
    const scheduler = startScheduler();
    store.failNextWrite = true;

    await expect(scheduler.schedule(inMinutes(1))).rejects.toThrow("Connection lost");
    await vi.advanceTimersByTimeAsync(MINUTE_MS);

    expect(ran).toEqual([]);
    expect(scheduler.listPending()).toEqual([]);
  });

  it("lists pending jobs soonest first", async () => {
    const scheduler = startScheduler();
    await scheduleJob(scheduler, inMinutes(30, "laundry"));
    await scheduleJob(scheduler, inMinutes(5, "tea"));

    expect(scheduler.listPending().map(job => job.label)).toEqual(["tea", "laundry"]);
  });

  it("gives each job its own short id", async () => {
    const scheduler = startScheduler();
    const first = await scheduleJob(scheduler, inMinutes(1));
    const second = await scheduleJob(scheduler, inMinutes(1));

    expect(first.id).toMatch(/^[0-9a-f]{6}$/);
    expect(second.id).not.toBe(first.id);
  });
});

describe("cancelling", () => {
  it("cancels by id: the job never runs and is recorded as cancelled", async () => {
    const scheduler = startScheduler();
    const job = await scheduleJob(scheduler, inMinutes(10));

    expect(await scheduler.cancel(job.id)).toMatchObject({ id: job.id });
    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS);

    expect(ran).toEqual([]);
    expect(store.get(job.id)?.status).toBe("cancelled");
  });

  it("cancels by part of the label", async () => {
    const scheduler = startScheduler();
    await scheduleJob(scheduler, inMinutes(10, "food in the oven"));

    expect(await scheduler.cancel("OVEN")).toMatchObject({ label: "food in the oven" });
    expect(scheduler.listPending()).toEqual([]);
  });

  it("returns null for a job it doesn't know", async () => {
    expect(await startScheduler().cancel("nope")).toBeNull();
  });

  it("keeps the timer when the cancellation can't be stored", async () => {
    const scheduler = startScheduler();
    const job = await scheduleJob(scheduler, inMinutes(10));
    store.failNextWrite = true;

    await expect(scheduler.cancel(job.id)).rejects.toThrow("Connection lost");
    expect(scheduler.listPending().map(j => j.id)).toEqual([job.id]);
  });
});

describe("restarting", () => {
  it("arms pending jobs again and runs each once", async () => {
    const before = startScheduler();
    await scheduleJob(before, inMinutes(10));
    before.stop();

    const after = startScheduler();
    await after.start();
    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS);

    expect(ran).toHaveLength(1);
  });

  it("does not bring back a job cancelled before the restart", async () => {
    const before = startScheduler();
    const job = await scheduleJob(before, inMinutes(10));
    await before.cancel(job.id);
    before.stop();

    const after = startScheduler();
    await after.start();
    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS);

    expect(ran).toEqual([]);
    expect(after.listPending()).toEqual([]);
  });

  it("drops a duration job that came due while the gateway was down", async () => {
    const before = startScheduler();
    const job = await scheduleJob(before, inMinutes(5));
    before.stop();

    vi.setSystemTime(START.getTime() + 20 * MINUTE_MS);
    const after = startScheduler();
    await after.start();
    await vi.advanceTimersByTimeAsync(MINUTE_MS);

    expect(ran).toEqual([]);
    expect(store.get(job.id)).toMatchObject({ status: "dropped", result: "came due while the gateway was down" });
  });
  // A clock-time job ("at 16:00") missed while the gateway was down, found at
  // startup this many minutes late.
  async function restartLateBy(lateMinutes: number): Promise<ScheduledJob> {
    const before = startScheduler();
    const job = await scheduleJob(before, { ...inMinutes(5, "the meat"), source: "at" });
    before.stop();

    vi.setSystemTime(job.runAt.getTime() + lateMinutes * MINUTE_MS);
    await startScheduler().start();
    await vi.advanceTimersByTimeAsync(0);
    return job;
  }

  it("still runs a clock-time job that came due up to 15 minutes ago", async () => {
    const job = await restartLateBy(10);

    expect(ran.map(r => r.id)).toEqual([job.id]);
    expect(store.get(job.id)?.status).toBe("done");
  });

  it("drops a clock-time job that came due more than 15 minutes ago", async () => {
    const job = await restartLateBy(20);

    expect(ran).toEqual([]);
    expect(store.get(job.id)).toMatchObject({
      status: "dropped",
      result: "came due more than 15 minutes before the gateway was back",
    });
  });

  it("never runs a job again that was running when the gateway stopped", async () => {
    const before = startScheduler(async job => {
      ran.push(job);
      // The gateway stops before the outcome is written.
      store.failNextWrite = true;
      return nextOutcome;
    });
    const job = await scheduleJob(before, { ...inMinutes(5, "the meat"), source: "at" });
    await vi.advanceTimersByTimeAsync(5 * MINUTE_MS);
    before.stop();
    expect(store.get(job.id)?.status).toBe("running");

    vi.setSystemTime(job.runAt.getTime() + 2 * MINUTE_MS);
    await startScheduler().start();
    await vi.advanceTimersByTimeAsync(MINUTE_MS);

    expect(ran).toHaveLength(1);
    expect(store.get(job.id)).toMatchObject({ status: "failed", result: "outcome unknown: it was running when the gateway stopped" });
  });
});

describe("claiming a due job", () => {
  it("doesn't report a cancel that lost the race with the job coming due", async () => {
    // The cancellation's write is held back until the job has been claimed.
    let releaseCancel!: () => void;
    const cancelHeld = new Promise<void>(resolve => { releaseCancel = resolve; });
    const finish = store.finish.bind(store);
    store.finish = async (...args) => {
      if (args[1] === "cancelled") await cancelHeld;
      return finish(...args);
    };
    // The job stays running until the test lets it finish.
    let finishRun!: () => void;
    const runHeld = new Promise<void>(resolve => { finishRun = resolve; });
    const scheduler = startScheduler(async job => {
      ran.push(job);
      await runHeld;
      return nextOutcome;
    });
    const job = await scheduleJob(scheduler, inMinutes(1));

    const cancelled = scheduler.cancel(job.id);
    await vi.advanceTimersByTimeAsync(MINUTE_MS);
    expect(store.get(job.id)?.status).toBe("running");
    releaseCancel();

    expect(await cancelled).toBeNull();
    finishRun();
    await vi.advanceTimersByTimeAsync(0);
    expect(ran.map(r => r.id)).toEqual([job.id]);
    expect(store.get(job.id)?.status).toBe("done");
  });


  it("marks it running in the store before it runs", async () => {
    const statusWhileRunning: (string | undefined)[] = [];
    const scheduler = startScheduler(async job => {
      statusWhileRunning.push(store.get(job.id)?.status);
      return nextOutcome;
    });
    const job = await scheduleJob(scheduler, inMinutes(1));

    await vi.advanceTimersByTimeAsync(MINUTE_MS);

    expect(statusWhileRunning).toEqual(["running"]);
    expect(store.get(job.id)?.status).toBe("done");
  });

  it("doesn't run a job it can't mark as running, and leaves it pending for the next start", async () => {
    const scheduler = startScheduler();
    const job = await scheduleJob(scheduler, { ...inMinutes(1, "the meat"), source: "at" });
    store.failNextWrite = true;

    await vi.advanceTimersByTimeAsync(MINUTE_MS);

    expect(ran).toEqual([]);
    expect(store.get(job.id)?.status).toBe("pending");
  });
});
