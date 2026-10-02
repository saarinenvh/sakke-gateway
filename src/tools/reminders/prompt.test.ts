import { describe, it, expect, afterEach } from "vitest";
import { reloadConfig } from "../../config.js";
import { remindersPrompt } from "./prompt.js";

afterEach(() => {
  delete process.env.MORNING_ENABLED;
  reloadConfig();
});

describe("good night", () => {
  it("asks about the coffee maker only while the morning wake-up is on", () => {
    process.env.MORNING_ENABLED = "true";
    reloadConfig();
    expect(remindersPrompt()).toContain("call coffee with set_loaded");

    process.env.MORNING_ENABLED = "false";
    reloadConfig();
    expect(remindersPrompt()).not.toContain("coffee");
  });

  it("no longer has a good-morning routine", () => {
    expect(remindersPrompt()).not.toMatch(/good morning|morning_routine/i);
  });
});
