import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startFakeOllama, toolCall, type FakeOllama } from "../fixtures/fakeOllama.js";
import { runAgent } from "../../src/agent/agent.js";
import { broadcastState, getCurrentState } from "../../src/features/display/display.js";
import { getConversation } from "../../src/agent/conversationStore.js";
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

const SAKKE = { profile: "sakke" } as const;

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

    const result = await runAgent("what is the weather", nextId(), log, SAKKE);

    expect(result.content).toBe("Grey and damp. Wear a coat.");
    expect(result.continueConversation).toBe(true);

    const [first, second] = ollama.requests();
    expect(first.hasTools).toBe(true);
    // The tool's result must be in context for the second call.
    expect(second.messages.some(m => m.role === "tool")).toBe(true);
  });

  it("sanitises the reply before returning it", async () => {
    ollama.script({ content: "<think>hmm</think>It is **cold**." });
    const result = await runAgent("weather", nextId(), log, SAKKE);
    expect(result.content).toBe("It is cold.");
  });
});

// Finding #2. This used to break out of the loop into the max-iterations path,
// so the user heard "I got confused trying to answer that." even though the
// tool had already succeeded.
describe("when the model repeats a tool call", () => {
  it("withholds the tool schema and gets a real answer", async () => {
    // run_routine is not repeatable - an identical repeat here has nothing
    // else in the batch to make progress, so it's the actual stuck case.
    ollama.script(
      { toolCalls: [toolCall("run_routine", { script_id: "good_night" })] },
      { toolCalls: [toolCall("run_routine", { script_id: "good_night" })] },   // identical - the loop detector fires
      { content: "Done. Obviously." },
    );

    const result = await runAgent("good night", nextId(), log, SAKKE);

    expect(result.content).toBe("Done. Obviously.");
    expect(result.content).not.toContain("I got confused");

    const passes = ollama.requests();
    expect(passes).toHaveLength(3);
    expect(passes.map(p => p.hasTools)).toEqual([true, true, false]);
  });

  it("does not speak tool-call syntax if the model emits it anyway", async () => {
    // Withholding the schema stops the runtime parsing a tool call, not the
    // model producing one - seen live, and read out by Piper verbatim.
    ollama.script(
      { toolCalls: [toolCall("run_routine", { script_id: "good_night" })] },
      { toolCalls: [toolCall("run_routine", { script_id: "good_night" })] },
      { content: '<tool_call>{"name": "run_routine", "arguments": {}}</tool_call>' },
    );

    const result = await runAgent("good night", nextId(), log, SAKKE);
    expect(result.content).not.toContain("tool_call");
    expect(result.content).toBe("That didn't work. Ask me again.");
  });

  // A batch that's entirely a repeat of a REPEATABLE tool isn't actually
  // stuck - it should just re-execute (fresh data), not force a final
  // answer from stale context.
  it("re-executes a repeatable tool instead of forcing a final answer, even when the whole batch already ran", async () => {
    ollama.script(
      { toolCalls: [toolCall("get_device_state", { entity_id: "light.hall" })] },
      { toolCalls: [toolCall("get_device_state", { entity_id: "light.hall" })] }, // identical, but repeatable
      { content: "Still off." },
    );

    const result = await runAgent("check the light again", nextId(), log, SAKKE);
    expect(result.content).toBe("Still off.");

    const passes = ollama.requests();
    expect(passes).toHaveLength(3);
    // Never withheld - the repeat re-executed normally both times instead of
    // triggering the stuck-loop path.
    expect(passes.map(p => p.hasTools)).toEqual([true, true, true]);
  });
});

const SKIPPED_REPEAT = "run_routine already ran this turn with the same arguments - not repeating it.";

// Finding #7 (CtjMmdnP). The loop only used to withhold tools when the WHOLE
// batch was already done - a batch mixing a repeat with a new call executed
// both, and two identical calls within one batch both executed too.
describe("duplicate tool calls within or across a batch", () => {
  it("skips a repeated non-repeatable call in a mixed batch, but still runs the new one", async () => {
    ollama.script(
      { toolCalls: [toolCall("run_routine", { script_id: "good_night" })] },
      { toolCalls: [
        toolCall("run_routine", { script_id: "good_night" }), // repeat - not repeatable
        toolCall("get_device_state", { entity_id: "light.hall" }), // new
      ] },
      { content: "Done." },
    );

    const result = await runAgent("good night", nextId(), log, SAKKE);
    expect(result.content).toBe("Done.");

    const passes = ollama.requests();
    expect(passes).toHaveLength(3);

    const toolMessages = passes[2].messages.filter(m => m.role === "tool");
    const [repeated, fresh] = toolMessages.slice(-2);
    expect(repeated.content).toBe(SKIPPED_REPEAT);
    expect(fresh.content).not.toBe(SKIPPED_REPEAT);
  });

  it("skips the second of two identical non-repeatable calls in the same batch", async () => {
    ollama.script(
      { toolCalls: [
        toolCall("run_routine", { script_id: "good_night" }),
        toolCall("run_routine", { script_id: "good_night" }),
      ] },
      { content: "Done." },
    );

    const result = await runAgent("good night twice", nextId(), log, SAKKE);
    expect(result.content).toBe("Done.");

    const toolMessages = ollama.requests()[1].messages.filter(m => m.role === "tool");
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages[0].content).not.toBe(SKIPPED_REPEAT);
    expect(toolMessages[1].content).toBe(SKIPPED_REPEAT);
  });

  it("still re-executes a repeatable tool even when the call is repeated", async () => {
    ollama.script(
      { toolCalls: [toolCall("get_device_state", { entity_id: "light.hall" })] },
      { toolCalls: [
        toolCall("get_device_state", { entity_id: "light.hall" }), // repeat - repeatable, should run again
        toolCall("run_routine", { script_id: "morning" }), // new
      ] },
      { content: "Done." },
    );

    const result = await runAgent("check and run", nextId(), log, SAKKE);
    expect(result.content).toBe("Done.");

    const toolMessages = ollama.requests()[2].messages.filter(m => m.role === "tool");
    const lastTwo = toolMessages.slice(-2);
    expect(lastTwo[0].content).not.toContain("already ran this turn");
    expect(lastTwo[1].content).not.toContain("already ran this turn");
  });

  // JSON.stringify preserves key insertion order, so the same logical
  // arguments with a different key order (plausible from a model
  // regenerating the same call) used to bypass the dedup key entirely.
  it("recognizes a repeated call even when its argument keys are in a different order", async () => {
    ollama.script(
      { toolCalls: [toolCall("schedule", { action: "set", when: { in_minutes: 5 }, label: "tea" })] },
      { toolCalls: [
        toolCall("schedule", { label: "tea", when: { in_minutes: 5 }, action: "set" }), // same call, keys reordered
        toolCall("get_device_state", { entity_id: "light.hall" }), // new
      ] },
      { content: "Done." },
    );

    const result = await runAgent("set a timer for tea, twice", nextId(), log, SAKKE);
    expect(result.content).toBe("Done.");

    const toolMessages = ollama.requests()[2].messages.filter(m => m.role === "tool");
    const [repeated, fresh] = toolMessages.slice(-2);
    expect(repeated.content).toBe("schedule already ran this turn with the same arguments - not repeating it.");
    expect(fresh.content).not.toContain("already ran this turn");
  });

  // manage_list bundles several actions under one tool - repeatability is
  // decided per action, not for the whole tool: list_read is a pure read,
  // list_add is a mutation.
  it("lets manage_list's list_read repeat but not a mutating action on the same tool", async () => {
    const listArgs = { list: "todo.groceries" };
    ollama.script(
      { toolCalls: [toolCall("manage_list", { action: "list_add", ...listArgs, item: "milk" })] },
      { toolCalls: [
        toolCall("manage_list", { action: "list_add", ...listArgs, item: "milk" }), // repeat - mutating, skip
        toolCall("manage_list", { action: "list_read", ...listArgs }), // new read
      ] },
      { toolCalls: [toolCall("manage_list", { action: "list_read", ...listArgs })] }, // repeat - read, re-executes
      { content: "Done." },
    );

    const result = await runAgent("add milk twice, then check the list", nextId(), log, SAKKE);
    expect(result.content).toBe("Done.");

    const passes = ollama.requests();
    expect(passes).toHaveLength(4);
    // Never withheld - the repeated read re-executed instead of being treated
    // as a stuck loop.
    expect(passes.map(p => p.hasTools)).toEqual([true, true, true, true]);

    const toolMessages = passes[3].messages.filter(m => m.role === "tool");
    const skipped = toolMessages.filter(m => m.content === "manage_list already ran this turn with the same arguments - not repeating it.");
    expect(skipped).toHaveLength(1); // only the repeated list_add, not either list_read
  });
});

// Finding #4. messages used to be the same array object held in the
// conversations map, so a thrown call left a dangling user turn behind and the
// next turn resumed from it.
describe("when a turn fails", () => {
  it("leaves no trace in the stored conversation", async () => {
    const id = nextId();

    ollama.script({ content: "First answer." });
    await runAgent("turn A", id, log, SAKKE);

    ollama.script({ status: 500 });
    await expect(runAgent("turn B", id, log, SAKKE)).rejects.toThrow();

    ollama.script({ content: "Third answer." });
    const third = await runAgent("turn C", id, log, SAKKE);
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
    await expect(runAgent("break", nextId(), log, SAKKE)).rejects.toThrow();
    expect(getCurrentState()).toBe("idle");
  });
});

describe("conversation control phrases", () => {
  it("wipes the conversation on a reset phrase without calling the model", async () => {
    const id = nextId();
    ollama.script({ content: "Remembered." });
    await runAgent("remember this", id, log, SAKKE);

    ollama.script();  // no scripted replies: any model call would fail
    const result = await runAgent("lets start fresh", id, log, SAKKE);

    expect(result.content).toContain("Wiped");
    expect(result.continueConversation).toBe(false);
    expect(ollama.requests()).toHaveLength(0);
  });
});

describe("tools outside the profile", () => {
  it("never offers a conversation the scheduler-only announce tool", async () => {
    ollama.script({ content: "Noted." });

    await runAgent("remind me later", nextId(), log, SAKKE);

    const [request] = ollama.requests();
    expect(request.toolNames).toContain("get_weather");
    expect(request.toolNames).not.toContain("announce");
  });

  it("refuses a made-up call to a registered tool the profile doesn't allow", async () => {
    ollama.script(
      { toolCalls: [toolCall("announce", { message: "hello" })] },
      { content: "I can't do that from here." },
    );

    await runAgent("announce hello", nextId(), log, SAKKE);

    const [, second] = ollama.requests();
    const toolResult = second.messages.find(m => m.role === "tool");
    expect(toolResult?.content).toBe("Unknown tool: announce");
  });
});

// Ollama restarts a loaded model whenever a request asks for a different
// context size, so a mismatch here reloaded the shared model twice per
// follow-up turn: once for the classifier, once more for the reply.
describe("a follow-up turn", () => {
  it("classifies with the same context size as the main agent", async () => {
    ollama.script({ content: "Clear sky, 12 degrees." }, { content: "Decent golf weather." });
    const id = nextId();

    await runAgent("what is the weather", id, log, SAKKE);
    await runAgent("is it good for golf?", id, log, SAKKE);

    const [classifierRequest] = ollama.classifierRequests();
    expect(classifierRequest.numCtx).toBe(ollama.requests()[0].numCtx);
  });

  // The model called a short answer to an offer noise on every eval run,
  // which silenced a real reply.
  it("answers a short reply to its own question even when the model would say noise", async () => {
    ollama.setClassifierVerdict("noise");
    try {
      ollama.script({ content: "Rain is expected. Would you like the hourly forecast?" }, { content: "Here's the hourly forecast." });
      const id = nextId();

      await runAgent("what's the weather tomorrow", id, log, SAKKE);
      const reply = await runAgent("Yes, please.", id, log, SAKKE);

      expect(reply.content).toBe("Here's the hourly forecast.");
      expect(ollama.classifierRequests()).toHaveLength(0);
    } finally {
      ollama.setClassifierVerdict("continuation");
    }
  });
});

describe("whose context a request is", () => {
  it("keeps a live conversation and shows it on the display", async () => {
    broadcastState("idle");
    ollama.script({ content: "Grey and damp." });
    const id = nextId();

    const result = await runAgent("what is the weather", id, log, SAKKE);

    expect(getConversation(id)).toBeDefined();
    expect(getCurrentState()).toBe("speaking");
    expect(result.continueConversation).toBe(true);
  });
});
