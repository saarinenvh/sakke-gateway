import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  type Message,
  contextBudgetChars,
  trimConversationHistory,
  getConversation,
  saveConversation,
  clearAwaitingContinuation,
  dropConversation,
  pruneStale,
  isChatModeRequest,
  isResetRequest,
  __clearAllConversations,
} from "./conversationStore.js";
import { clearSpotifySuggestion } from "../spotify/spotify.js";

vi.mock("../spotify/spotify.js", () => ({ clearSpotifySuggestion: vi.fn() }));

const NUM_CTX = 16384;
const BUDGET = contextBudgetChars(NUM_CTX);

const sys = (n = 100): Message => ({ role: "system", content: "S".repeat(n) });
const turn = (tag: string, size: number): Message[] => [
  { role: "user", content: tag },
  { role: "assistant", content: tag.repeat(size / tag.length) },
];

beforeEach(() => {
  __clearAllConversations();
  vi.mocked(clearSpotifySuggestion).mockClear();
});

describe("contextBudgetChars", () => {
  it("reserves room for the response and for the tool schemas", () => {
    // The tool schemas ship with every request. Leaving them out of the budget
    // is how the original overflow got in.
    expect(BUDGET).toBeLessThan((NUM_CTX - 2000) * 4);
    expect(BUDGET).toBeGreaterThan(0);
  });

  it("goes non-positive for a context too small to hold a reply", () => {
    expect(contextBudgetChars(1024)).toBeLessThanOrEqual(0);
  });
});

describe("trimConversationHistory", () => {
  it("leaves a conversation that fits entirely alone", () => {
    const messages = [sys(), ...turn("a", 100), ...turn("b", 100)];
    const before = [...messages];
    trimConversationHistory(messages, NUM_CTX);
    expect(messages).toEqual(before);
  });

  it("drops the oldest whole turns until the rest fits", () => {
    const size = Math.floor(BUDGET * 0.4);
    const messages = [sys(), ...turn("a", size), ...turn("b", size), ...turn("c", size)];
    trimConversationHistory(messages, NUM_CTX);

    // 1.2 budgets' worth of history: the oldest turn goes, the other two stay.
    expect(messages.map(m => m.role)).toEqual(["system", "user", "assistant", "user", "assistant"]);
    expect(messages[1].content).toBe("b");
    expect(messages[3].content).toBe("c");
  });

  it("always keeps the system prompt", () => {
    const messages = [sys(), ...turn("a", BUDGET), ...turn("b", BUDGET), ...turn("c", BUDGET)];
    trimConversationHistory(messages, NUM_CTX);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content.startsWith("S")).toBe(true);
  });

  it("counts the system prompt against the budget", () => {
    // It used to be excluded (slice(1)), which ignored the single largest block
    // in the conversation - it carries every area, scene, script and list plus
    // the whole wiki index. With a prompt this size, a short history already
    // overflows, and a trimmer that can't see it would do nothing.
    const messages = [sys(Math.floor(BUDGET * 0.9)), ...turn("a", Math.floor(BUDGET * 0.2)), ...turn("b", 500)];
    trimConversationHistory(messages, NUM_CTX);
    expect(messages.map(m => m.content[0])).toEqual(["S", "b", "b"]);
  });

  it("keeps the in-progress turn even when it alone is oversized", () => {
    // Nothing sensible left to trim - dropping the turn being answered would
    // leave the model with no question.
    const messages: Message[] = [sys(), { role: "user", content: "x".repeat(BUDGET * 3) }];
    trimConversationHistory(messages, NUM_CTX);
    expect(messages).toHaveLength(2);
  });

  it("never leaves a tool result without the assistant message that asked for it", () => {
    const big = "x".repeat(Math.floor(BUDGET * 0.9));
    const messages: Message[] = [
      sys(),
      { role: "user", content: "what is on" },
      { role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "get_device_state", arguments: {} } }] },
      { role: "tool", content: big, tool_call_id: "1" },
      { role: "assistant", content: "The light is on." },
      { role: "user", content: "turn it off" },
      { role: "assistant", content: big },
    ];
    trimConversationHistory(messages, NUM_CTX);

    // The whole first turn goes as a unit - an orphaned tool message is a
    // malformed request Ollama rejects outright.
    expect(messages.some(m => m.role === "tool")).toBe(false);
    expect(messages.map(m => m.role)).toEqual(["system", "user", "assistant"]);
  });

  it("does nothing at all when the context is too small to budget for", () => {
    const messages = [sys(), ...turn("a", 5000)];
    const before = [...messages];
    trimConversationHistory(messages, 1024);
    expect(messages).toEqual(before);
  });

  it("counts tool_calls, not just content, toward the budget", () => {
    // An assistant message that only carries tool_calls has empty content; if
    // that weighed nothing, a tool-heavy conversation would never be trimmed.
    const heavy: Message[] = Array.from({ length: 40 }, (_, i) => ({
      role: "assistant" as const,
      content: "",
      tool_calls: [{ id: `${i}`, type: "function" as const, function: { name: "x".repeat(BUDGET / 20), arguments: {} } }],
    }));
    const messages: Message[] = [sys(), { role: "user", content: "a" }, ...heavy, { role: "user", content: "b" }];
    trimConversationHistory(messages, NUM_CTX);
    expect(messages.length).toBeLessThan(heavy.length);
  });
});

describe("the conversation store", () => {
  it("round-trips a saved conversation and stamps it active", () => {
    saveConversation("c1", { messages: [sys()], chatMode: true, awaitingContinuation: true });
    const conv = getConversation("c1");
    expect(conv?.chatMode).toBe(true);
    expect(conv?.lastActive).toBeGreaterThan(0);
  });

  it("clearing awaitingContinuation does not extend the idle window", () => {
    // Noise in the room shouldn't keep a conversation alive.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      saveConversation("c1", { messages: [sys()], chatMode: false, awaitingContinuation: true });
      const stamped = getConversation("c1")!.lastActive;

      vi.setSystemTime(1_000_000 + 60_000);
      clearAwaitingContinuation("c1");

      expect(getConversation("c1")!.awaitingContinuation).toBe(false);
      expect(getConversation("c1")!.lastActive).toBe(stamped);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forgets the Spotify suggestions keyed by the same id when a conversation is dropped", () => {
    saveConversation("c1", { messages: [sys()], chatMode: false, awaitingContinuation: true });
    dropConversation("c1");
    expect(getConversation("c1")).toBeUndefined();
    expect(clearSpotifySuggestion).toHaveBeenCalledWith("c1");
  });

  it("prunes conversations idle past the timeout and keeps the rest", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      saveConversation("old", { messages: [sys()], chatMode: false, awaitingContinuation: true });

      vi.setSystemTime(1_000_000 + 11 * 60 * 1000);
      saveConversation("fresh", { messages: [sys()], chatMode: false, awaitingContinuation: true });
      pruneStale();

      expect(getConversation("old")).toBeUndefined();
      expect(getConversation("fresh")).toBeDefined();
      // Pruning has to clear the suggestion too - timers.ts mints a fresh
      // conversation id per timer, so these accumulate for the process lifetime.
      expect(clearSpotifySuggestion).toHaveBeenCalledWith("old");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("phrase matching", () => {
  it("recognises chat mode through trailing punctuation and casing", () => {
    expect(isChatModeRequest("Let's chat!")).toBe(true);
    expect(isChatModeRequest("  LETS TALK.  ")).toBe(true);
    expect(isChatModeRequest("let's chat about the weather")).toBe(false);
  });

  it("recognises a reset without swallowing sentences that merely contain one", () => {
    expect(isResetRequest("Start over.")).toBe(true);
    expect(isResetRequest("reset")).toBe(true);
    expect(isResetRequest("reset the router")).toBe(false);
  });
});
