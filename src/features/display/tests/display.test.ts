import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { broadcastState, getCurrentState, showSpeakingWhile, speakingDurationMs } from "../display.js";

// A speech attempt the test finishes by hand.
function pendingSpeech() {
  let succeed!: () => void;
  let fail!: (err: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    succeed = resolve;
    fail = reject;
  });
  return { speak: () => promise, succeed, fail };
}

beforeEach(() => {
  vi.useFakeTimers();
  broadcastState("idle");
});

afterEach(() => vi.useRealTimers());

describe("showSpeakingWhile", () => {
  it("shows speaking for the speech's length, then idle", async () => {
    const text = "The pasta is done.";

    await showSpeakingWhile(text, async () => {});
    expect(getCurrentState()).toBe("speaking");

    vi.advanceTimersByTime(speakingDurationMs(text));
    expect(getCurrentState()).toBe("idle");
  });

  it("goes back to idle when the speech fails", async () => {
    await expect(showSpeakingWhile("The pasta is done.", async () => {
      throw new Error("satellite unreachable");
    })).rejects.toThrow("satellite unreachable");

    expect(getCurrentState()).toBe("idle");
  });

  it("leaves a newer speech showing when an earlier one fails", async () => {
    const first = pendingSpeech();
    const second = pendingSpeech();
    const firstDone = showSpeakingWhile("The pasta is done.", first.speak).catch(() => {});
    const secondDone = showSpeakingWhile("The tea is ready.", second.speak);

    first.fail(new Error("satellite unreachable"));
    await firstDone;
    expect(getCurrentState()).toBe("speaking");

    second.succeed();
    await secondDone;
    vi.advanceTimersByTime(speakingDurationMs("The tea is ready.") - 1);
    expect(getCurrentState()).toBe("speaking");
  });

  it("leaves any state shown since alone when the speech fails", async () => {
    const speech = pendingSpeech();
    const done = showSpeakingWhile("The pasta is done.", speech.speak).catch(() => {});

    broadcastState("thinking");
    speech.fail(new Error("satellite unreachable"));
    await done;

    expect(getCurrentState()).toBe("thinking");
  });
});
