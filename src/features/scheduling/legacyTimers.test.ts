import { beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FakeJobStore } from "../../../tests/fixtures/fakeJobStore.js";
import { importLegacyTimers, LEGACY_TIMERS_FILE } from "./legacyTimers.js";

const NOW = new Date("2026-09-29T09:00:00.000Z");
const log: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => log };

let stateDir: string;
let store: FakeJobStore;
const timersFile = () => join(stateDir, LEGACY_TIMERS_FILE);

const savedTimers = [
  { id: "a1b2c", label: "food in the oven", endsAt: NOW.getTime() + 30 * 60_000 },
  { id: "d3e4f", label: "tea", endsAt: NOW.getTime() - 60_000 },
];

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "sakke-legacy-timers-"));
  store = new FakeJobStore();
});

describe("importing timers.json", () => {
  it("turns each saved timer into a pending announce job with its old id", async () => {
    writeFileSync(timersFile(), JSON.stringify(savedTimers));

    expect(await importLegacyTimers(store, stateDir, NOW, log)).toBe(2);

    expect(store.get("a1b2c")).toMatchObject({
      runAt: new Date(savedTimers[0].endsAt),
      source: "in",
      tool: "announce",
      args: { message: "The timer for food in the oven is done." },
      label: "food in the oven",
      status: "pending",
    });
    // Expired ones too: the scheduler drops them at start, so they show up in
    // the history instead of vanishing.
    expect(store.get("d3e4f")?.status).toBe("pending");
  });

  it("deletes the file once the import is stored", async () => {
    writeFileSync(timersFile(), JSON.stringify(savedTimers));

    await importLegacyTimers(store, stateDir, NOW, log);

    expect(existsSync(timersFile())).toBe(false);
  });

  it("imports nothing twice when a crash left the file behind", async () => {
    writeFileSync(timersFile(), JSON.stringify(savedTimers));
    await importLegacyTimers(store, stateDir, NOW, log);
    writeFileSync(timersFile(), JSON.stringify(savedTimers));

    await importLegacyTimers(store, stateDir, NOW, log);

    expect(store.all()).toHaveLength(2);
  });

  it("keeps the file when the import can't be stored, so it runs again next start", async () => {
    writeFileSync(timersFile(), JSON.stringify(savedTimers));
    store.failNextWrite = true;

    await expect(importLegacyTimers(store, stateDir, NOW, log)).rejects.toThrow("Connection lost");

    expect(existsSync(timersFile())).toBe(true);
  });

  it("leaves an unreadable file in place and imports nothing", async () => {
    writeFileSync(timersFile(), "{ not json");

    expect(await importLegacyTimers(store, stateDir, NOW, log)).toBe(0);

    expect(store.all()).toEqual([]);
    expect(readFileSync(timersFile(), "utf-8")).toBe("{ not json");
  });

  it("does nothing when there is no file", async () => {
    expect(await importLegacyTimers(store, stateDir, NOW, log)).toBe(0);
    expect(store.all()).toEqual([]);
  });
});
