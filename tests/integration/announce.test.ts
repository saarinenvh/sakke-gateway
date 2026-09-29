import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeHomeAssistant, type FakeHomeAssistant } from "../fixtures/fakeHomeAssistant.js";
import { announce, setWordingWriter, WORDING_TIMEOUT_MS } from "../../src/features/announcements/announcer.js";
import { executeTool } from "../../src/tools/registry.js";
import { config, reloadConfig } from "../../src/config.js";

// announce against a fake Home Assistant. The wording writer is replaced per
// test; in production index.ts wires in the agent.

let ha: FakeHomeAssistant;
// The fake keeps every call it has seen; each test looks only at its own.
let callsBeforeTest = 0;

interface LogEntry {
  msg: string;
  fields: Record<string, unknown>;
  satelliteCallsSoFar: number;
}
let entries: LogEntry[];
const record = (fields: Record<string, unknown>, msg: string) => {
  entries.push({ msg, fields, satelliteCallsSoFar: satelliteMessages().length });
};
const log: any = { info: record, warn: record, error: record, debug: () => {}, child: () => log };

function serviceCallsInTest() {
  return ha.serviceCalls().slice(callsBeforeTest);
}

function satelliteMessages(): unknown[] {
  return serviceCallsInTest()
    .filter(call => call.domain === "assist_satellite" && call.service === "announce")
    .map(call => call.data.message);
}

beforeAll(async () => {
  ha = await startFakeHomeAssistant();
  process.env.HA_BASE_URL = ha.url;
  process.env.HA_TOKEN = "test-token";
  process.env.ASSIST_SATELLITE_ENTITY_ID = "assist_satellite.test";
  reloadConfig();
});

afterAll(async () => {
  await ha.close();
  for (const key of ["HA_BASE_URL", "HA_TOKEN", "ASSIST_SATELLITE_ENTITY_ID"]) delete process.env[key];
  reloadConfig();
});

beforeEach(() => {
  entries = [];
  callsBeforeTest = ha.serviceCalls().length;
});

afterEach(() => vi.useRealTimers());

describe("announce", () => {
  it("speaks Sakke's wording on the configured satellite", async () => {
    setWordingWriter(async message => `Pardon the interruption: ${message}.`);

    const result = await announce("the pasta is done", log);

    expect(result).toEqual({ spoken: "Pardon the interruption: the pasta is done.", wording: "generated" });
    const [call] = serviceCallsInTest();
    expect(call.data).toEqual({ entity_id: "assist_satellite.test", message: "Pardon the interruption: the pasta is done." });
  });

  it("logs the line before calling the satellite, so it is visible without Home Assistant", async () => {
    setWordingWriter(async () => "The pasta is done.");

    await announce("the pasta is done", log);

    const announcing = entries.find(entry => entry.msg === "Announcing");
    expect(announcing?.fields.spoken).toBe("The pasta is done.");
    expect(announcing?.satelliteCallsSoFar).toBe(0);
  });

  it("speaks the message as it is when the wording fails", async () => {
    setWordingWriter(async () => {
      throw new Error("ollama unreachable");
    });

    const result = await announce("take the meat out of the fridge", log);

    expect(result).toEqual({ spoken: "take the meat out of the fridge", wording: "fallback" });
    expect(satelliteMessages()).toEqual(["take the meat out of the fridge"]);
  });

  it("speaks the message as it is when the wording comes back empty", async () => {
    setWordingWriter(async () => "   ");

    const result = await announce("take the meat out of the fridge", log);

    expect(result.wording).toBe("fallback");
    expect(satelliteMessages()).toEqual(["take the meat out of the fridge"]);
  });

  it("stops waiting for the wording after the timeout and speaks the message", async () => {
    // Only setTimeout: the Home Assistant request's own AbortSignal.timeout
    // stays on real time.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    setWordingWriter(() => new Promise<string>(() => {}));

    const announced = announce("take the meat out of the fridge", log);
    await vi.advanceTimersByTimeAsync(WORDING_TIMEOUT_MS);

    await expect(announced).resolves.toEqual({ spoken: "take the meat out of the fridge", wording: "fallback" });
    expect(satelliteMessages()).toEqual(["take the meat out of the fridge"]);
  });

  it("throws when the satellite can't be reached, so a caller can tell it wasn't spoken", async () => {
    setWordingWriter(async message => message);
    const satellite = config.ha.baseUrl;
    config.ha.baseUrl = "http://127.0.0.1:1";
    try {
      await expect(announce("the pasta is done", log)).rejects.toThrow();
    } finally {
      config.ha.baseUrl = satellite;
    }
  });
});

describe("the announce tool", () => {
  it("speaks the message and reports it", async () => {
    setWordingWriter(async () => "The pasta is done.");

    expect(await executeTool("announce", { message: "the pasta is done" }, log, "announce-test")).toBe("Announced.");
    expect(satelliteMessages()).toEqual(["The pasta is done."]);
  });

  it("says when it used the message as written", async () => {
    setWordingWriter(async () => {
      throw new Error("ollama unreachable");
    });

    expect(await executeTool("announce", { message: "the pasta is done" }, log, "announce-test"))
      .toBe("Announced, with the message as written.");
  });

  it("refuses an empty message without calling the satellite", async () => {
    const result = await executeTool("announce", { message: "  " }, log, "announce-test");

    expect(result).toMatch(/^announce failed/);
    expect(satelliteMessages()).toEqual([]);
  });

  it("reports a failure when the satellite can't be reached", async () => {
    setWordingWriter(async message => message);
    const satellite = config.ha.baseUrl;
    config.ha.baseUrl = "http://127.0.0.1:1";
    try {
      expect(await executeTool("announce", { message: "the pasta is done" }, log, "announce-test")).toMatch(/^announce failed/);
    } finally {
      config.ha.baseUrl = satellite;
    }
  });
});
