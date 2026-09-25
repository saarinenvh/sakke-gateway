import { describe, it, expect } from "vitest";
import { cleanForSpeech } from "./voiceText.js";

const speak = (raw: string | undefined) => cleanForSpeech(raw, false);

// Each group below is a bug that reached the speaker.

describe("model scaffolding never reaches Piper", () => {
  it("strips a think block", () => {
    expect(speak("<think>weighing this up</think>Lights on.")).toBe("Lights on.");
  });

  it("strips a channel marker and everything after it", () => {
    expect(speak("Done.<channel|>internal noise")).toBe("Done.");
  });

  // 2026-09-24: withholding the tool schema stops the runtime PARSING a tool
  // call, not the model emitting one, so this arrived as content and was read
  // out verbatim.
  it("strips a complete tool_call block", () => {
    expect(speak('<tool_call>{"name": "get_weather", "arguments": {}}</tool_call>Cold.')).toBe("Cold.");
  });

  it("strips an unterminated tool_call and everything after it", () => {
    expect(speak('Fine. <tool_call>{"name": "x"')).toBe("Fine.");
  });

  it("falls back when a tool_call was the entire response", () => {
    const onlyToolCall = '<tool_call>{"name": "get_weather", "arguments": {}}</tool_call>';
    expect(cleanForSpeech(onlyToolCall, true)).toBe("That didn't work. Ask me again.");
  });
});

describe("markdown never reaches Piper", () => {
  // ab480f8: Piper read "https://www.time.gov/" out loud, character by character.
  it("keeps link text and drops the URL", () => {
    expect(speak("Check [time.gov](https://www.time.gov/) for that.")).toBe("Check time.gov for that.");
  });

  it("strips bold, italic and underscore emphasis", () => {
    expect(speak("That is **very** much *not* __happening__.")).toBe("That is very much not happening.");
  });

  it("strips headers", () => {
    expect(speak("## Shopping list. Milk.")).toBe("Shopping list. Milk.");
  });

  it("strips bullet markers", () => {
    expect(speak("- milk\n- bread")).toBe("milk. bread");
  });

  it("strips numbered list markers", () => {
    expect(speak("1. milk\n2. bread")).toBe("milk. bread");
  });

  it("turns line breaks into sentence breaks rather than running words together", () => {
    // Spaces here would produce "Found metal Slayer Maiden" as one breathless
    // phrase; sentence breaks give the voice somewhere to pause.
    expect(speak("Found:\nMetallica\nSlayer")).toBe("Found: Metallica. Slayer");
  });
});

describe("ordinary prose is left alone", () => {
  // The real risk in a chain of twelve regexes is over-stripping, and nothing
  // guarded that before these tests existed.
  it.each([
    "Cold and damp. Wear a coat, or do not.",
    "It is 14 degrees, feels like 12.",
    "Playing Discover Weekly. Try to look surprised.",
    "The scene is lit. 3 of 5 lights were already on.",
    "I set a timer for 20 minutes. Label: pasta.",
    "Your 10:30 is a dentist appointment. My condolences.",
  ])("passes through unchanged: %s", (prose) => {
    expect(speak(prose)).toBe(prose);
  });

  it("does not eat an asterisk that is not emphasis", () => {
    expect(speak("The rating was 4 out of 5 *")).toBe("The rating was 4 out of 5 *");
  });

  it("does not treat a hyphen mid-sentence as a bullet", () => {
    expect(speak("Cold - and getting colder.")).toBe("Cold - and getting colder.");
  });
});

describe("empty responses", () => {
  it.each([undefined, "", "   ", "<think>only thinking</think>"])(
    "falls back to the normal line for %o", (raw) => {
      expect(cleanForSpeech(raw, false)).toBe("I got nothing.");
    });

  it("admits the problem instead when the tool schema was withheld", () => {
    expect(cleanForSpeech("", true)).toBe("That didn't work. Ask me again.");
  });
});
