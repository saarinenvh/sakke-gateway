import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startFakeOllama, type FakeOllama } from "../fixtures/fakeOllama.js";
import { writeText } from "../../src/inference/writeText.js";
import { setSystemPromptBuilder } from "../../src/inference/systemPrompt.js";
import { buildSystemPrompt } from "../../src/agent/systemPrompt.js";
import { broadcastState, getCurrentState } from "../../src/features/display/display.js";
import { reloadConfig } from "../../src/config.js";

// A piece of text a feature asks for: it must never act, and it leaves no
// trace - no history, nothing on the display.

let ollama: FakeOllama;
const log: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => log };

beforeAll(async () => {
  ollama = await startFakeOllama();
  process.env.OLLAMA_BASE_URL = ollama.url;
  process.env.OLLAMA_MODEL = "fake-model";
  process.env.HA_BASE_URL = "http://127.0.0.1:1";
  process.env.WIKI_ROOT = "/nonexistent-wiki";
  reloadConfig();
  setSystemPromptBuilder(buildSystemPrompt);
});

afterAll(async () => {
  await ollama.close();
  for (const key of ["OLLAMA_BASE_URL", "OLLAMA_MODEL", "HA_BASE_URL", "WIKI_ROOT"]) delete process.env[key];
  reloadConfig();
});

beforeEach(() => ollama.script());

describe("writeText", () => {
  it("never offers the tool schema", async () => {
    ollama.script({ content: "Shall I vacuum, or do you enjoy the dust?" });

    const text = await writeText("tidiness_nag", "write the nag", log);

    expect(text).toBe("Shall I vacuum, or do you enjoy the dust?");
    expect(ollama.requests().map(r => r.hasTools)).toEqual([false]);
  });

  it("leaves the display alone", async () => {
    broadcastState("idle");
    ollama.script({ content: "Time's up on the pasta, sir." });

    const text = await writeText("announcement", "Tell the owner this now: Time's up: the pasta.", log);

    expect(text).toBe("Time's up on the pasta, sir.");
    expect(getCurrentState()).toBe("idle");
  });

  it("starts every request from the system prompt alone", async () => {
    ollama.script({ content: "First line." }, { content: "Second line." });

    await writeText("announcement", "say the first thing", log);
    await writeText("announcement", "say the second thing", log);

    const [, second] = ollama.requests();
    expect(second.messages.map(m => m.role)).toEqual(["system", "user"]);
  });
});
