import { describe, it, expect } from "vitest";
import { stripCodeFence } from "./text.js";

describe("stripCodeFence", () => {
  it("strips a ```json fence", () => {
    expect(stripCodeFence("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
  });

  it("strips a fence with no language tag", () => {
    expect(stripCodeFence("```\n{\"a\":1}\n```")).toBe('{"a":1}');
  });

  it("is case-insensitive on the language tag", () => {
    expect(stripCodeFence("```JSON\n{\"a\":1}\n```")).toBe('{"a":1}');
  });

  it("leaves unfenced content unchanged", () => {
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });

  it("trims surrounding whitespace either way", () => {
    expect(stripCodeFence('  {"a":1}  ')).toBe('{"a":1}');
  });

  it("only strips a fence at the very start and end, not one embedded mid-content", () => {
    const content = "Here's the plan:\n```json\n{\"a\":1}\n```\nHope that helps!";
    expect(stripCodeFence(content)).toBe(content);
  });
});
