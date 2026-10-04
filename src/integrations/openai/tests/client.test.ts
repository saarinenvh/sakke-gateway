import { describe, it, expect, vi, afterEach } from "vitest";
import { chatCompletion, OpenAiError } from "../client.js";
import { ValidationError } from "../../../util/validation.js";
import { reloadConfig } from "../../../config.js";

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

const MESSAGES = [{ role: "user" as const, content: "Design a scene" }];

// Captures what chatCompletion sent, answering with a minimal valid completion.
function captureRequest(): { body: () => Record<string, unknown>; headers: () => Headers } {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] })),
  );
  vi.stubGlobal("fetch", fetchMock);
  const init = (): RequestInit => fetchMock.mock.calls[0][1];
  return {
    body: () => JSON.parse(String(init().body)) as Record<string, unknown>,
    headers: () => new Headers(init().headers),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  reloadConfig();
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

    await expect(chatCompletion("gpt-4o", MESSAGES)).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps an HTTP failure an OpenAiError", async () => {
    respondWith({ error: { message: "Rate limited" } }, 429);

    await expect(chatCompletion("gpt-4o", MESSAGES)).rejects.toBeInstanceOf(OpenAiError);
  });
});

describe("chatCompletion request", () => {
  it("authenticates with the sakke-public key", async () => {
    vi.stubEnv("OPENAI_PUBLIC_API_KEY", "sk-public");
    reloadConfig();
    const request = captureRequest();

    await chatCompletion("gpt-4o", MESSAGES);

    expect(request.headers().get("Authorization")).toBe("Bearer sk-public");
  });

  it("sends temperature but not reasoning_effort to a chat model", async () => {
    const request = captureRequest();

    await chatCompletion("gpt-4.1", MESSAGES, { temperature: 0.7, reasoningEffort: "low" });

    expect(request.body()).toEqual({ model: "gpt-4.1", messages: MESSAGES, temperature: 0.7 });
  });

  it.each(["gpt-5", "gpt-5.4", "gpt-5.4-mini", "o3", "o4-mini"])(
    "sends reasoning_effort but not temperature to %s",
    async model => {
      const request = captureRequest();

      await chatCompletion(model, MESSAGES, { temperature: 0.7, reasoningEffort: "low" });

      expect(request.body()).toEqual({ model, messages: MESSAGES, reasoning_effort: "low" });
    },
  );

  it("leaves reasoning_effort out when none is configured", async () => {
    const request = captureRequest();

    await chatCompletion("gpt-5.4", MESSAGES, { temperature: 0.7 });

    expect(request.body()).toEqual({ model: "gpt-5.4", messages: MESSAGES });
  });
});
