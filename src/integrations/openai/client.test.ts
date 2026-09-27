import { describe, it, expect, vi, afterEach } from "vitest";
import { chatCompletion, OpenAiError, OpenAiInvalidResponseError } from "./client.js";

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

const MESSAGES = [{ role: "user" as const, content: "Design a scene" }];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chatCompletion", () => {
  it("returns the first choice's content, trimmed", async () => {
    respondWith({ choices: [{ message: { role: "assistant", content: "  {\"name\": \"x\"}\n" } }] });

    await expect(chatCompletion("gpt-4o", MESSAGES)).resolves.toBe("{\"name\": \"x\"}");
  });

  it("returns an empty string when the model answers with null content", async () => {
    respondWith({ choices: [{ message: { role: "assistant", content: null } }] });

    await expect(chatCompletion("gpt-4o", MESSAGES)).resolves.toBe("");
  });

  it("rejects a response with no choices instead of treating it as an empty answer", async () => {
    respondWith({ choices: [] });

    await expect(chatCompletion("gpt-4o", MESSAGES)).rejects.toBeInstanceOf(OpenAiInvalidResponseError);
  });

  it("keeps an HTTP failure an OpenAiError", async () => {
    respondWith({ error: { message: "Rate limited" } }, 429);

    await expect(chatCompletion("gpt-4o", MESSAGES)).rejects.toBeInstanceOf(OpenAiError);
  });
});
