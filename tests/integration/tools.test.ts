import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startFakeHomeAssistant, type FakeHomeAssistant } from "../fixtures/fakeHomeAssistant.js";
import { executeTool } from "../../src/tools/executor.js";
import { reloadConfig } from "../../src/config.js";

// The tool layer's Home Assistant paths - TV control, device state, routines.
// Written against executeTool(name, args, log, conversationId) deliberately:
// that signature survives the tool-registry refactor, so these tests carry over
// and protect the move rather than being rewritten with it.

let ha: FakeHomeAssistant;
const log: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => log };
const run = (name: string, args: Record<string, unknown> = {}) => executeTool(name, args, log, "tools-test");

beforeAll(async () => {
  ha = await startFakeHomeAssistant();
  process.env.HA_BASE_URL = ha.url;
  process.env.HA_TOKEN = "test-token";
  reloadConfig();
});

afterAll(async () => {
  await ha.close();
  delete process.env.HA_BASE_URL;
  delete process.env.HA_TOKEN;
  reloadConfig();
});

beforeEach(() => ha.setItems("todo.unused", []));   // also clears recorded calls

describe("get_device_state", () => {
  it("returns the state and attributes as JSON", async () => {
    ha.setState("media_player.living_room_tv", "playing", { source: "Netflix" });
    const result = await run("get_device_state", { entity_id: "media_player.living_room_tv" });
    expect(JSON.parse(result)).toEqual({ state: "playing", attributes: { source: "Netflix" } });
  });

  it("reports an error for an unknown entity rather than throwing", async () => {
    const result = await run("get_device_state", { entity_id: "light.does_not_exist" });
    expect(result).toContain("Error fetching state");
  });
});

describe("run_routine", () => {
  it("turns on the script and says which one", async () => {
    const result = await run("run_routine", { script_id: "good_night" });
    expect(ha.serviceCalls()).toContainEqual({
      domain: "script", service: "turn_on", data: { entity_id: "script.good_night" },
    });
    expect(result).toContain("good_night");
  });
});

describe("open_tv_app", () => {
  it("launches the app directly when the TV is already on", async () => {
    ha.setState("remote.living_room_tv", "on");
    await run("open_tv_app", { app: "netflix" });

    const calls = ha.serviceCalls().filter(c => c.domain === "remote");
    // One call, carrying the activity - no redundant wake.
    expect(calls).toHaveLength(1);
    expect(calls[0].data).toHaveProperty("activity");
  });

  it("wakes the TV first when it is off", async () => {
    ha.setState("remote.living_room_tv", "off");
    await run("open_tv_app", { app: "youtube" });

    const calls = ha.serviceCalls().filter(c => c.domain === "remote");
    expect(calls).toHaveLength(2);
    expect(calls[0].data).not.toHaveProperty("activity");   // the wake
    expect(calls[1].data).toHaveProperty("activity");       // then the launch
  }, 10_000);   // the wake path sleeps 5s for the TV to come up

  it("refuses an app it doesn't know, without calling Home Assistant", async () => {
    ha.setState("remote.living_room_tv", "on");
    const result = await run("open_tv_app", { app: "myspace" });
    expect(result).toContain("Unknown app");
    expect(ha.serviceCalls()).toHaveLength(0);
  });
});

describe("tv_remote_command", () => {
  it("sends the mapped keycode", async () => {
    await run("tv_remote_command", { command: "home" });
    expect(ha.serviceCalls()).toContainEqual({
      domain: "remote", service: "send_command",
      data: { entity_id: "remote.living_room_tv", command: "HOME" },
    });
  });

  it("confirms in words that can't be misread as a question", async () => {
    // "Sent home to the TV" reads as a normal English sentence and has confused
    // the model into asking the user to clarify its own tool result.
    const result = await run("tv_remote_command", { command: "home" });
    expect(result).toBe("Exited to the TV home screen.");
  });

  it("refuses an unknown command without calling Home Assistant", async () => {
    const result = await run("tv_remote_command", { command: "eject" });
    expect(result).toContain("Unknown remote command");
    expect(ha.serviceCalls()).toHaveLength(0);
  });
});

describe("tv_send_text", () => {
  it("sends the text as a remote command", async () => {
    await run("tv_send_text", { text: "ensiferum" });
    expect(ha.serviceCalls()).toContainEqual({
      domain: "remote", service: "send_command",
      data: { entity_id: "remote.living_room_tv", command: "text:ensiferum" },
    });
  });
});

describe("error handling", () => {
  it("returns a tool error string rather than throwing, so the loop can continue", async () => {
    // Every tool result goes back into the conversation; a thrown error would
    // take down the whole turn instead of giving the model something to react to.
    ha.failAfter(0);
    const result = await run("run_routine", { script_id: "good_night" });
    expect(result).toContain("Routine failed");
  });

  it("names an unknown tool instead of failing silently", async () => {
    expect(await run("teleport")).toContain("Unknown tool");
  });
});
