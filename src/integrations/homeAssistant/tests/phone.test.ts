import { describe, it, expect } from "vitest";
import { buildSpokenNotification } from "../phone.js";

describe("buildSpokenNotification", () => {
  it("is spoken at once on a locked phone: high priority, no time-to-live, the alarm stream", () => {
    expect(buildSpokenNotification("Good morning.")).toEqual({
      message: "TTS",
      data: { tts_text: "Good morning.", media_stream: "alarm_stream", priority: "high", ttl: 0 },
    });
  });
});
