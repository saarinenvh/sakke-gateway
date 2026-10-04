import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { startFakeHomeAssistant, type FakeHomeAssistant } from "../fixtures/fakeHomeAssistant.js";
import { executeTool } from "../../src/tools/registry.js";
import { vacuumTool } from "../../src/tools/vacuum/tool.js";
import { vacuumPrompt } from "../../src/tools/vacuum/prompt.js";
import { reloadConfig } from "../../src/config.js";
import { loadEntities } from "../../src/integrations/homeAssistant/registry.js";
import { __resetTidinessState, getTidinessState, recordClean, recordNag } from "../../src/features/tidiness/store.js";

// The vacuum tool against a fake Home Assistant.

let ha: FakeHomeAssistant;
const log: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => log };
const run = (args: Record<string, unknown>) => executeTool("vacuum", args, log, "vacuum-test");
const VACUUM = "vacuum.robot";

beforeAll(async () => {
  ha = await startFakeHomeAssistant();
  process.env.HA_BASE_URL = ha.url;
  process.env.HA_TOKEN = "test-token";
});

afterAll(async () => {
  await ha.close();
  for (const key of ["HA_BASE_URL", "HA_TOKEN", "TIDINESS_VACUUM_ENTITY_ID", "STATE_DIR"]) delete process.env[key];
  reloadConfig();
});

beforeEach(async () => {
  process.env.TIDINESS_VACUUM_ENTITY_ID = VACUUM;
  process.env.STATE_DIR = mkdtempSync(join(tmpdir(), "sakke-vacuum-"));
  reloadConfig();
  __resetTidinessState();
  ha.setItems("todo.unused", []); // also clears recorded service calls
  ha.setState(VACUUM, "docked", { battery_level: 80 });
  await loadEntities(); // registry cache is module state; start each test unnamed
});

describe("moving the vacuum", () => {
  it.each([
    ["start", "start"],
    ["stop", "stop"],
    ["dock", "return_to_base"],
  ])("%s calls vacuum.%s on the configured vacuum", async (action, service) => {
    await run({ action });
    expect(ha.serviceCalls()).toContainEqual({ domain: "vacuum", service, data: { entity_id: VACUUM } });
  });

  it("answers a cleaning reminder asked a moment ago with a yes when started", async () => {
    await recordNag({ slot: "2026-10-08#0", askedAt: Date.now(), delivery: "delivered" });
    await run({ action: "start" });
    expect(getTidinessState().nags[0].answer).toBe("yes");
  });

  it("fails, rather than pretending to start one, when there is no vacuum", async () => {
    delete process.env.TIDINESS_VACUUM_ENTITY_ID;
    reloadConfig();
    ha.removeState(VACUUM);
    await loadEntities();

    // A failure, not a result: a scheduled start must not be reported as done.
    expect(await run({ action: "start" })).toBe("vacuum failed: There is no robot vacuum in Home Assistant.");
    expect(ha.serviceCalls()).toEqual([]);
  });
});

describe("the vacuum's name", () => {
  beforeEach(async () => {
    delete process.env.TIDINESS_VACUUM_ENTITY_ID;
    reloadConfig();
    ha.setState(VACUUM, "docked", { friendly_name: "James" });
    await loadEntities();
  });

  it("uses the name the owner gave it in HA", async () => {
    expect(await run({ action: "start" })).toContain("James");
  });

  it("says who did the last clean by name", async () => {
    await recordClean(Date.now(), "vacuum");
    expect(await run({ action: "last_cleaned" })).toContain("today, by James");
  });

  it("tells the model the vacuum is called James", () => {
    expect(vacuumPrompt()).toContain("it is called James");
  });

  it("stays out of the prompt when HA only knows the entity id", async () => {
    ha.setState(VACUUM, "docked", {});
    await loadEntities();
    expect(vacuumPrompt()).toBe("");
    expect(await run({ action: "start" })).toContain("The robot vacuum");
  });
});

describe("status", () => {
  it("reports state and battery, and admits not knowing the last clean", async () => {
    const result = await run({ action: "status" });
    expect(result).toContain("docked, battery 80%");
    expect(result).toContain("not known yet");
  });

  it("reads battery from the vacuum's own battery sensor when the vacuum has none", async () => {
    delete process.env.TIDINESS_VACUUM_ENTITY_ID;
    reloadConfig();
    ha.setState(VACUUM, "docked", { friendly_name: "Robot" });
    ha.setState("sensor.robot_battery_level", "64", { device_class: "battery" });
    await loadEntities();

    expect(await run({ action: "status" })).toContain("battery 64%");
  });

  it("answers when the house was last cleaned, with the date once it's days ago", async () => {
    await recordClean(Date.now() - 3 * 86_400_000, "vacuum");
    const result = await run({ action: "last_cleaned" });
    expect(result).toMatch(/last cleaned 3 days ago, on (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \d{1,2} \w+, by the robot vacuum/);
    expect(result).not.toContain("battery");
  });

  it("reports a manual clean recorded by mark_cleaned", async () => {
    await run({ action: "mark_cleaned" });
    expect(await run({ action: "status" })).toContain("last cleaned today, by hand");
  });
});

describe("answers to a cleaning reminder", () => {
  it("records a decline on the reminder just asked", async () => {
    await recordNag({ slot: "2026-10-08#0", askedAt: Date.now(), delivery: "delivered" });
    await run({ action: "decline" });
    expect(getTidinessState().nags[0].answer).toBe("no");
  });

  it("snoozes reminders for the configured time", async () => {
    const before = Date.now();
    await run({ action: "snooze" });
    expect(getTidinessState().snoozedUntil).toBeGreaterThanOrEqual(before + 24 * 3_600_000);
  });

  it("lets only the read-only actions repeat within a turn", () => {
    expect(["status", "last_cleaned"].every(action => vacuumTool.repeatable({ action }))).toBe(true);
    expect(["start", "stop", "dock", "mark_cleaned", "decline", "snooze"].some(action => vacuumTool.repeatable({ action }))).toBe(false);
  });

  it("rejects an unknown action through validation", async () => {
    expect(await run({ action: "mop" })).toContain("vacuum tool arguments failed validation");
  });
});
