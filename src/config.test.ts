import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { config, reloadConfig } from "./config.js";

// Every variable config.ts reads, so a test can start from a known-empty
// environment rather than inheriting whatever the shell happens to have.
const MANAGED = [
  "PORT", "TZ", "STATE_DIR", "WIKI_ROOT",
  "OLLAMA_BASE_URL", "OLLAMA_MODEL", "OLLAMA_NUM_CTX", "OLLAMA_THINK", "OLLAMA_KEEP_ALIVE",
  "OLLAMA_CLASSIFIER_BASE_URL", "OLLAMA_CLASSIFIER_MODEL",
  "PC_OLLAMA_BASE_URL", "PC_OLLAMA_MODEL", "PC_OLLAMA_NUM_CTX", "PC_OLLAMA_THINK", "PC_OLLAMA_KEEP_ALIVE",
  "HA_BASE_URL", "HA_TOKEN", "ASSIST_SATELLITE_ENTITY_ID", "TASKS_TODO", "CALENDAR_ENTITIES",
  "SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET",
  "OPENAI_API_KEY", "OPENAI_LIGHTING_MODEL",
  "SEARXNG_URL", "WEATHER_LAT", "WEATHER_LON",
];

const original = Object.fromEntries(MANAGED.map(k => [k, process.env[k]]));

function env(values: Record<string, string>): void {
  for (const key of MANAGED) delete process.env[key];
  Object.assign(process.env, values);
  reloadConfig();
}

beforeEach(() => env({}));

afterAll(() => {
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  reloadConfig();
});

// The bug this whole module exists to prevent. docker-compose substitutes an
// unset variable as an empty string, so `process.env.X ?? "default"` yields ""
// rather than the default - which took get_weather down in production, because
// Open-Meteo answers a request with empty coordinates with HTTP 200 and a
// zero-byte body.
describe("blank is not the same as unset", () => {
  it("falls back to the default for a blank string value", () => {
    env({ WEATHER_LAT: "", WEATHER_LON: "" });
    expect(config.weather.lat).toBe("60.1583");
    expect(config.weather.lon).toBe("24.7339");
  });

  it("falls back for whitespace, not just empty", () => {
    env({ OLLAMA_MODEL: "   " });
    expect(config.ollama.server.model).toBe("qwen3:8b");
  });

  it("does not turn a blank numeric value into zero", () => {
    // Number("") is 0, which as a context window would silently truncate
    // every prompt.
    env({ OLLAMA_NUM_CTX: "" });
    expect(config.ollama.server.numCtx).toBe(32768);
  });

  it("ignores a non-numeric value rather than producing NaN", () => {
    env({ OLLAMA_NUM_CTX: "banana" });
    expect(config.ollama.server.numCtx).toBe(32768);
  });

  it("uses a real numeric value when given one", () => {
    env({ OLLAMA_NUM_CTX: "8192" });
    expect(config.ollama.server.numCtx).toBe(8192);
  });
});

describe("Ollama targets", () => {
  it("has no PC target unless PC_OLLAMA_BASE_URL is set, so routing stays on the server", () => {
    expect(config.ollama.pc).toBeNull();
  });

  it("treats a blank PC_OLLAMA_BASE_URL as no PC target", () => {
    env({ PC_OLLAMA_BASE_URL: "" });
    expect(config.ollama.pc).toBeNull();
  });

  it("inherits the server model when the PC model is not set", () => {
    env({ OLLAMA_MODEL: "qwen3:4b", PC_OLLAMA_BASE_URL: "http://pc:11434" });
    expect(config.ollama.pc?.model).toBe("qwen3:4b");
  });

  it("does not let a blank PC model override the inherited one with nothing", () => {
    env({ OLLAMA_MODEL: "qwen3:4b", PC_OLLAMA_BASE_URL: "http://pc:11434", PC_OLLAMA_MODEL: "" });
    expect(config.ollama.pc?.model).toBe("qwen3:4b");
  });

  it("keeps the PC model when it is set", () => {
    env({ OLLAMA_MODEL: "qwen3:4b", PC_OLLAMA_BASE_URL: "http://pc:11434", PC_OLLAMA_MODEL: "qwen3:14b" });
    expect(config.ollama.pc?.model).toBe("qwen3:14b");
  });

  // An "instruct" build rejects any request carrying `think`, with a 400 on
  // every tool call - so undefined (omit the field) is meaningfully different
  // from false (send think: false).
  it.each([
    ["true", true],
    ["false", false],
    ["", undefined],
    ["yes", undefined],
  ])("parses OLLAMA_THINK=%o as %o", (value, expected) => {
    env({ OLLAMA_THINK: value });
    expect(config.ollama.server.think).toBe(expected);
  });

  it("defaults to the container's host, not localhost", () => {
    // "localhost" inside this container is the container itself; the previous
    // default could not have worked in any real deployment.
    expect(config.ollama.server.baseUrl).toBe("http://host.docker.internal:11434");
    expect(config.ha.baseUrl).toBe("http://host.docker.internal:8123");
  });
});

describe("problems reported at startup", () => {
  it("names a missing HA_TOKEN and what it breaks", () => {
    const problem = config.problems.find(p => p.includes("HA_TOKEN"));
    expect(problem).toMatch(/Home Assistant/);
  });

  it("names a missing classifier URL", () => {
    expect(config.problems.some(p => p.includes("OLLAMA_CLASSIFIER_BASE_URL"))).toBe(true);
  });

  it("reports nothing when the required values are present", () => {
    env({ HA_TOKEN: "t", OLLAMA_CLASSIFIER_BASE_URL: "http://host.docker.internal:11434" });
    expect(config.problems).toEqual([]);
  });

  it("treats a blank required value as missing", () => {
    env({ HA_TOKEN: "", OLLAMA_CLASSIFIER_BASE_URL: "http://x:11434" });
    expect(config.problems.some(p => p.includes("HA_TOKEN"))).toBe(true);
  });
});

describe("calendar entities", () => {
  it("splits on commas and trims", () => {
    env({ CALENDAR_ENTITIES: "calendar.a, calendar.b ,calendar.c" });
    expect(config.ha.calendarEntities).toEqual(["calendar.a", "calendar.b", "calendar.c"]);
  });

  it("is empty rather than [''] when unset", () => {
    expect(config.ha.calendarEntities).toEqual([]);
  });
});

describe("reloadConfig", () => {
  it("keeps the same object identity, so modules holding a reference see the change", () => {
    const before = config;
    env({ OLLAMA_MODEL: "changed" });
    expect(config).toBe(before);
    expect(config.ollama.server.model).toBe("changed");
  });
});
