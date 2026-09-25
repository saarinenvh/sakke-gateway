import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Timers used to live only in a Map, so every `s build` silently discarded
// whatever was running and the person who set one simply never heard it.
//
// A "restart" here is vi.resetModules plus a re-import against the same state
// directory: fresh module state, same disk. The scheduler is importable on its
// own now that it no longer reaches for the agent - it pulls two modules rather
// than the nineteen it used to.

let stateDir: string;

async function restart() {
  vi.resetModules();
  const { reloadConfig } = await import("../../src/config.js");
  reloadConfig();
  return import("../../src/timers/timers.js");
}

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "sakke-timers-"));
  process.env.STATE_DIR = stateDir;
});

afterAll(() => {
  delete process.env.STATE_DIR;
});

const settle = () => new Promise(r => setTimeout(r, 60));
const timersFile = () => join(stateDir, "timers.json");

describe("persistence", () => {
  it("writes timers to disk as they are set", async () => {
    const timers = await restart();
    timers.setTimer(30 * 60_000, "food in the oven");
    await settle();

    expect(existsSync(timersFile())).toBe(true);
    const saved = JSON.parse(readFileSync(timersFile(), "utf-8"));
    expect(saved).toHaveLength(1);
    expect(saved[0].label).toBe("food in the oven");
  });

  it("re-arms a still-running timer after a restart", async () => {
    const before = await restart();
    before.setTimer(45 * 60_000, "laundry");
    await settle();

    const after = await restart();
    expect(after.listTimers()).toHaveLength(0);   // fresh process, nothing in memory

    await after.restoreTimers();

    const restored = after.listTimers();
    expect(restored).toHaveLength(1);
    expect(restored[0].label).toBe("laundry");
    expect(restored[0].remainingMs).toBeGreaterThan(44 * 60_000);
  });

  it("drops a timer that came due while the service was down", async () => {
    const before = await restart();
    before.setTimer(40, "already finished");     // fires almost immediately
    before.setTimer(45 * 60_000, "still going");
    await settle();

    const after = await restart();
    await after.restoreTimers();

    // Announcing a timer that expired during a restart is worse than not
    // announcing it, so it is dropped rather than fired late.
    expect(after.listTimers().map(t => t.label)).toEqual(["still going"]);
  });

  it("forgets a cancelled timer across a restart", async () => {
    const before = await restart();
    const id = before.setTimer(30 * 60_000, "cancel me");
    before.setTimer(30 * 60_000, "keep me");
    await settle();

    before.cancelTimer(id);
    await settle();

    const after = await restart();
    await after.restoreTimers();
    expect(after.listTimers().map(t => t.label)).toEqual(["keep me"]);
  });

  it("starts clean when there is no state file", async () => {
    const timers = await restart();
    await timers.restoreTimers();
    expect(timers.listTimers()).toEqual([]);
  });

  it("keeps working when the state directory cannot be written", async () => {
    // Persistence is best-effort: an unwritable volume degrades to the old
    // in-memory behaviour rather than breaking the feature.
    process.env.STATE_DIR = "/proc/nonexistent/timers";
    const timers = await restart();
    const id = timers.setTimer(30 * 60_000, "still works");
    await settle();

    expect(id).toBeTruthy();
    expect(timers.listTimers()).toHaveLength(1);
  });
});

describe("firing", () => {
  it("calls the injected handler with the label, and forgets the timer", async () => {
    const timers = await restart();
    const fired: string[] = [];
    timers.setTimerHandler(async label => { fired.push(label); });

    timers.setTimer(40, "pasta");
    await settle();

    expect(fired).toEqual(["pasta"]);
    expect(timers.listTimers()).toEqual([]);
  });

  it("survives a handler that throws", async () => {
    const timers = await restart();
    timers.setTimerHandler(async () => { throw new Error("announce failed"); });

    timers.setTimer(40, "doomed");
    await settle();

    // The timer is still cleared, and nothing escapes to crash the process.
    expect(timers.listTimers()).toEqual([]);
  });
});

describe("cancelling", () => {
  it("cancels by id", async () => {
    const timers = await restart();
    const id = timers.setTimer(30 * 60_000, "pasta");
    expect(timers.cancelTimer(id)).toBe("pasta");
    expect(timers.listTimers()).toEqual([]);
  });

  it("cancels by partial label when the id isn't to hand", async () => {
    const timers = await restart();
    timers.setTimer(30 * 60_000, "food in the oven");
    expect(timers.cancelTimer("oven")).toBe("food in the oven");
  });

  it("returns null for a timer that isn't there", async () => {
    const timers = await restart();
    expect(timers.cancelTimer("nonexistent")).toBeNull();
  });
});
