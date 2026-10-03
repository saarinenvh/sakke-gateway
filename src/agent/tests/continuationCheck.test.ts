import { describe, it, expect } from "vitest";
import type { Message } from "../../integrations/ollama/types.js";
import { recentExchanges } from "../continuationCheck.js";

const user = (content: string): Message => ({ role: "user", content });
const reply = (content: string): Message => ({ role: "assistant", content });

describe("recentExchanges", () => {
  it("returns the only exchange of a single-command conversation", () => {
    const messages = [{ role: "system", content: "persona" } as const, user("Turn on the lights."), reply("Lights are on.")];

    expect(recentExchanges(messages)).toEqual([{ user: "Turn on the lights.", assistant: "Lights are on." }]);
  });

  it("keeps the last two exchanges, oldest first", () => {
    const messages = [
      user("one"), reply("first"),
      user("two"), reply("second"),
      user("three"), reply("third"),
    ];

    expect(recentExchanges(messages)).toEqual([
      { user: "two", assistant: "second" },
      { user: "three", assistant: "third" },
    ]);
  });

  it("pairs the user with the final reply, skipping tool calls and results", () => {
    const messages: Message[] = [
      user("What's the weather?"),
      { role: "assistant", content: "", tool_calls: [{ function: { name: "get_weather", arguments: {} } }] },
      { role: "tool", content: "Conditions: clear sky" },
      reply("Clear sky."),
    ];

    expect(recentExchanges(messages)).toEqual([{ user: "What's the weather?", assistant: "Clear sky." }]);
  });

  it("shortens a long reply so it can't crowd out the new speech", () => {
    const [exchange] = recentExchanges([user("Search the news."), reply("x".repeat(1000))]);

    expect(exchange.assistant.length).toBeLessThan(400);
    expect(exchange.assistant.endsWith("...")).toBe(true);
  });
});
