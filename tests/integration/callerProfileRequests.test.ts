import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { writeText } from "../../src/inference/writeText.js";
import { setSystemPromptBuilder } from "../../src/inference/systemPrompt.js";
import { buildSystemPrompt } from "../../src/agent/systemPrompt.js";
import { reloadConfig } from "../../src/config.js";
import { announce } from "../../src/features/announcements/announcements.js";

// What each tool-less caller profile sends to Ollama, byte for byte: the
// system prompt, the messages and the request options. Pinned so that moving
// how this text is written can't change the model's input unnoticed.

const log: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => log };

// A reply with markdown, so the speech cleanup that follows is pinned too.
const MODEL_REPLY = "**Good morning!** Coffee is *ready*.";

const CALLER_REQUESTS = [
  ["announcement", "Tell the owner this now, out loud, in your own words and briefly: the pasta is done"],
  ["tidiness_nag", "Ask whether to clean; it has been 9 days."],
  ["morning_greeting", "Write the good morning."],
  ["morning_brief", "Summarise the day."],
] as const;

let server: http.Server;
let bodies: unknown[] = [];

async function writeFor(profile: (typeof CALLER_REQUESTS)[number][0], request: string): Promise<string> {
  return writeText(profile, request, log);
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => (raw += chunk));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ message: { role: "assistant", content: MODEL_REPLY } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.OLLAMA_MODEL = "fake-model";
  process.env.HA_BASE_URL = "http://127.0.0.1:1";
  process.env.WIKI_ROOT = "/nonexistent-wiki";
  process.env.TZ = "Europe/Helsinki";
  reloadConfig();
  setSystemPromptBuilder(buildSystemPrompt);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T06:30:00Z"));
});

afterAll(async () => {
  vi.useRealTimers();
  await new Promise<void>(resolve => server.close(() => resolve()));
  for (const key of ["OLLAMA_BASE_URL", "OLLAMA_MODEL", "HA_BASE_URL", "WIKI_ROOT"]) delete process.env[key];
  reloadConfig();
});

describe("caller profile requests", () => {
  it.each(CALLER_REQUESTS)("%s sends the pinned request and cleans the reply", async (profile, request) => {
    bodies = [];
    const text = await writeFor(profile, request);
    expect(bodies).toHaveLength(1);
    await expect(JSON.stringify({ request: bodies[0], text }, null, 2) + "\n")
      .toMatchFileSnapshot(`__snapshots__/callerProfileRequests/${profile}.json`);
  });

  // The other callers build their requests in prompts.ts files their own tests
  // cover; the announcer builds its request inline, so pin it through announce.
  it("the announcer sends the pinned announcement request", async () => {
    const [, pinnedRequest] = CALLER_REQUESTS[0];
    bodies = [];
    await writeFor("announcement", pinnedRequest);
    const [pinned] = bodies;

    bodies = [];
    // Home Assistant is unreachable here, so speaking fails after the wording.
    await announce("the pasta is done", log).catch(() => undefined);

    expect(bodies).toEqual([pinned]);
  });
});
