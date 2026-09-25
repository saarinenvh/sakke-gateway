import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildSystemPrompt, refreshClock } from "./systemPrompt.js";
import { reloadConfig } from "../config.js";

// Nothing here should reach a real Home Assistant. The list section degrades to
// a placeholder when it can't, which is the behaviour under test anyway.
beforeAll(() => {
  process.env.HA_BASE_URL = "http://127.0.0.1:9";
  process.env.WIKI_ROOT = "/nonexistent-wiki";
  reloadConfig();
});

afterAll(() => {
  delete process.env.HA_BASE_URL;
  delete process.env.WIKI_ROOT;
  reloadConfig();
  vi.useRealTimers();
});

describe("composition", () => {
  it("includes every section, in order", async () => {
    const prompt = await buildSystemPrompt();
    const positions = [
      "deadpan butler",                 // persona
      "acting versus talking about acting", // tool discipline
      "Home control:",
      "Lists: use manage_list",
      "Tasks and calendar are different",
      "Music: use the spotify tool",
      "Weather: use get_weather",
      "Web search:",
      "Knowledge:",
      "Current date and time:",
    ].map(marker => {
      const at = prompt.indexOf(marker);
      expect(at, `missing section: ${marker}`).toBeGreaterThan(-1);
      return at;
    });

    // Order is load-bearing: who Sakke is, then the rule that matters most,
    // then capabilities, then the live state of the house.
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("degrades instead of throwing when Home Assistant and the wiki are unreachable", async () => {
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("unable to load lists right now");
    // No wiki index to offer, but the create_knowledge rules still apply.
    expect(prompt).toContain("Knowledge:");
    expect(prompt).not.toContain("Knowledge base — call get_context");
  });
});

describe("refreshClock", () => {
  // The system prompt is built once per conversation and stored with its
  // history, so without refreshing, the clock freezes at the first turn.
  it("updates the clock line of an already-built prompt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T09:00:00Z"));
    const original = await buildSystemPrompt();

    vi.setSystemTime(new Date("2026-01-15T17:30:00Z"));
    const refreshed = refreshClock(original);

    expect(refreshed).not.toBe(original);

    // Exactly one line changed, and it is the clock line.
    const before = original.split("\n");
    const after = refreshed.split("\n");
    const differing = before.map((line, i) => [line, after[i]]).filter(([a, b]) => a !== b);
    expect(differing).toHaveLength(1);
    expect(differing[0][0]).toMatch(/^Current date and time:/);
    vi.useRealTimers();
  });

  // This is the hazard worth pinning. String.replace with no match returns the
  // input unchanged, so any drift between CLOCK_PREFIX and what the clock
  // section emits freezes the clock with no error anywhere.
  it("is a silent no-op when no clock line is present", () => {
    expect(refreshClock("no clock in here")).toBe("no clock in here");
  });

  it("emits the clock as exactly one whole line, which is what the anchored regex needs", async () => {
    // The other half of the coupling. refreshClock matches
    // /^Current date and time:.*$/m, so the clock has to be its own line at
    // line start - indent it, wrap it in a sentence, or emit it twice, and the
    // refresh silently stops working.
    const prompt = await buildSystemPrompt();
    const clockLines = prompt.split("\n").filter(line => line.startsWith("Current date and time:"));
    expect(clockLines).toHaveLength(1);
    expect(clockLines[0]).toMatch(/^Current date and time: .+ \(.+\)\.$/);
  });
});
