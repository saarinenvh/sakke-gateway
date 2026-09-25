import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startFakeOllama, toolCall, type FakeOllama } from "../fixtures/fakeOllama.js";
import { runAgent } from "../../src/agent/agent.js";
import { getCurrentState } from "../../src/display/displayState.js";
import { reloadConfig } from "../../src/config.js";

// The tool-calling loop against a scripted model. Everything here is a bug that
// reached production; the loop is the one piece of this service with real
// state, and none of it was covered before.

let ollama: FakeOllama;

// runAgent wants a Fastify logger. Nothing here asserts on logging.
const log: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => log };

// Each test uses its own conversation id, since the conversation store is
// module state shared across the file.
let n = 0;
const nextId = () => `test-${Date.now()}-${n++}`;

beforeAll(async () => {
  ollama = await startFakeOllama();
  process.env.OLLAMA_BASE_URL = ollama.url;
  process.env.OLLAMA_CLASSIFIER_BASE_URL = ollama.url;
  process.env.OLLAMA_MODEL = "fake-model";
  // Nothing should reach a real Home Assistant or wiki; both degrade by design.
  process.env.HA_BASE_URL = "http://127.0.0.1:1";
  process.env.WIKI_ROOT = "/nonexistent-wiki";
  reloadConfig();
});

afterAll(async () => {
  await ollama.close();
  for (const key of ["OLLAMA_BASE_URL", "OLLAMA_CLASSIFIER_BASE_URL", "OLLAMA_MODEL", "HA_BASE_URL", "WIKI_ROOT"]) {
    delete process.env[key];
  }
  reloadConfig();
});

beforeEach(() => ollama.script());

describe("a normal turn", () => {
  it("calls a tool, feeds the result back, and answers in prose", async () => {
    ollama.script(
      { toolCalls: [toolCall("get_weather")] },
      { content: "Grey and damp. Wear a coat." },
    );

    const result = await runAgent("what is the weather", nextId(), log);

    expect(result.content).toBe("Grey and damp. Wear a coat.");
    expect(result.continueConversation).toBe(true);

    const [first, second] = ollama.requests();
    expect(first.hasTools).toBe(true);
    // The tool's result must be in context for the second call.
    expect(second.messages.some(m => m.role === "tool")).toBe(true);
  });

  it("sanitises the reply before returning it", async () => {
    ollama.script({ content: "<think>hmm</think>It is **cold**." });
    const result = await runAgent("weather", nextId(), log);
    expect(result.content).toBe("It is cold.");
  });
});

// Finding #2. This used to break out of the loop into the max-iterations path,
// so the user heard "I got confused trying to answer that." even though the
// tool had already succeeded.
describe("when the model repeats a tool call", () => {
  it("withholds the tool schema and gets a real answer", async () => {
    ollama.script(
      { toolCalls: [toolCall("get_weather")] },
      { toolCalls: [toolCall("get_weather")] },   // identical - the loop detector fires
      { content: "Cold and damp. Obviously." },
    );

    const result = await runAgent("weather", nextId(), log);

    expect(result.content).toBe("Cold and damp. Obviously.");
    expect(result.content).not.toContain("I got confused");

    const passes = ollama.requests();
    expect(passes).toHaveLength(3);
    expect(passes.map(p => p.hasTools)).toEqual([true, true, false]);
  });

  it("does not speak tool-call syntax if the model emits it anyway", async () => {
    // Withholding the schema stops the runtime parsing a tool call, not the
    // model producing one - seen live, and read out by Piper verbatim.
    ollama.script(
      { toolCalls: [toolCall("get_weather")] },
      { toolCalls: [toolCall("get_weather")] },
      { content: '<tool_call>{"name": "get_weather", "arguments": {}}</tool_call>' },
    );

    const result = await runAgent("weather", nextId(), log);
    expect(result.content).not.toContain("tool_call");
    expect(result.content).toBe("That didn't work. Ask me again.");
  });
});

// Finding #4. messages used to be the same array object held in the
// conversations map, so a thrown call left a dangling user turn behind and the
// next turn resumed from it.
describe("when a turn fails", () => {
  it("leaves no trace in the stored conversation", async () => {
    const id = nextId();

    ollama.script({ content: "First answer." });
    await runAgent("turn A", id, log);

    ollama.script({ status: 500 });
    await expect(runAgent("turn B", id, log)).rejects.toThrow();

    ollama.script({ content: "Third answer." });
    const third = await runAgent("turn C", id, log);
    expect(third.content).toBe("Third answer.");

    const history = ollama.requests()[0].messages;
    const roles = history.map(m => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(history.map(m => m.content).join("\n")).not.toContain("turn B");
  });

  it("returns the display to idle rather than leaving it on thinking", async () => {
    // "thinking" is broadcast before the loop and only the success path cleared
    // it, so a failure left the tablet spinning until the next good turn.
    ollama.script({ status: 500 });
    await expect(runAgent("break", nextId(), log)).rejects.toThrow();
    expect(getCurrentState()).toBe("idle");
  });
});

describe("conversation control phrases", () => {
  it("wipes the conversation on a reset phrase without calling the model", async () => {
    const id = nextId();
    ollama.script({ content: "Remembered." });
    await runAgent("remember this", id, log);

    ollama.script();  // no scripted replies: any model call would fail
    const result = await runAgent("lets start fresh", id, log);

    expect(result.content).toContain("Wiped");
    expect(result.continueConversation).toBe(false);
    expect(ollama.requests()).toHaveLength(0);
  });
});
