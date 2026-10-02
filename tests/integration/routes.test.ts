import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { startFakeOllama, type FakeOllama } from "../fixtures/fakeOllama.js";
import { reloadConfig } from "../../src/config.js";

// The HTTP surface, through app.inject() - no port, no listening, no teardown
// races. The gateway's callers are Home Assistant automations and the voice
// pipeline, so the response shapes here are a contract with things outside this
// repo.

let app: FastifyInstance;
let ollama: FakeOllama;

beforeAll(async () => {
  ollama = await startFakeOllama();
  process.env.OLLAMA_BASE_URL = ollama.url;
  process.env.OLLAMA_CLASSIFIER_BASE_URL = ollama.url;
  process.env.HA_BASE_URL = "http://127.0.0.1:1";
  process.env.WIKI_ROOT = "/nonexistent-wiki";
  reloadConfig();

  app = buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ollama.close();
  for (const k of ["OLLAMA_BASE_URL", "OLLAMA_CLASSIFIER_BASE_URL", "HA_BASE_URL", "WIKI_ROOT"]) {
    delete process.env[k];
  }
  reloadConfig();
});

describe("GET /health", () => {
  it("is ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe("POST /internal/gpu-status", () => {
  it("accepts a push from the PC", async () => {
    const res = await app.inject({
      method: "POST", url: "/internal/gpu-status", payload: { state: "available" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it.each(["idle", "", "AVAILABLE", null])("rejects an invalid state: %o", async (state) => {
    const res = await app.inject({
      method: "POST", url: "/internal/gpu-status", payload: { state },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a push with the PC's idle time", async () => {
    const res = await app.inject({
      method: "POST", url: "/internal/gpu-status", payload: { state: "available", idleSeconds: 12.5, heartbeat: true },
    });
    expect(res.statusCode).toBe(200);
    const status = await app.inject({ method: "GET", url: "/internal/gpu-status" });
    expect(status.json().lastInputAt).toEqual(expect.any(String));
  });

  it.each([-1, "12", null, Number.POSITIVE_INFINITY, 1e13])("rejects an invalid idle time: %o", async (idleSeconds) => {
    const res = await app.inject({
      method: "POST", url: "/internal/gpu-status", payload: { state: "available", idleSeconds },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a push with no body as a bad request, not a server error", async () => {
    const res = await app.inject({ method: "POST", url: "/internal/gpu-status" });
    expect(res.statusCode).toBe(400);
  });

  it("reports the cached state back", async () => {
    await app.inject({ method: "POST", url: "/internal/gpu-status", payload: { state: "busy" } });
    const res = await app.inject({ method: "GET", url: "/internal/gpu-status" });
    expect(res.json()).toMatchObject({ state: "busy", source: "auto" });
  });
});

describe("POST /display/state", () => {
  it("accepts a known state and reports it back", async () => {
    const res = await app.inject({ method: "POST", url: "/display/state", payload: { state: "listening" } });
    expect(res.statusCode).toBe(200);

    const current = await app.inject({ method: "GET", url: "/display/state" });
    expect(current.json()).toEqual({ state: "listening" });

    await app.inject({ method: "POST", url: "/display/state", payload: { state: "idle" } });
  });

  it.each([{ state: "dancing" }, { state: null }, undefined])("rejects an invalid state change: %o", async (payload) => {
    const res = await app.inject({ method: "POST", url: "/display/state", payload });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/chat/completions", () => {
  it("returns an OpenAI-shaped response with the continue flag", async () => {
    ollama.script({ content: "Lights on." });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { conversation_id: "routes-1", messages: [{ role: "user", content: "lights on" }] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.choices[0].message).toEqual({ role: "assistant", content: "Lights on." });
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(body.continue_conversation).toBe(true);
  });

  it("adds a forwarded extra_system_prompt to the turn, just before the user's answer", async () => {
    ollama.script({ content: "Right away." });
    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        conversation_id: "routes-extra-prompt",
        messages: [{ role: "user", content: "sure, clean it" }],
        extra_system_prompt: "You just asked the owner whether to run the vacuum.",
      },
    });

    const messages = ollama.requests().at(-1)?.messages ?? [];
    expect(messages.slice(-2)).toEqual([
      { role: "system", content: "You just asked the owner whether to run the vacuum." },
      { role: "user", content: "sure, clean it" },
    ]);
  });

  it("uses the last user message when the client sends a whole history", async () => {
    ollama.script({ content: "The second one." });
    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        conversation_id: "routes-2",
        messages: [
          { role: "user", content: "first thing" },
          { role: "assistant", content: "ok" },
          { role: "user", content: "second thing" },
        ],
      },
    });
    const sent = ollama.requests()[0].messages;
    expect(sent[sent.length - 1].content).toBe("second thing");
  });

  it("answers an empty utterance without calling the model", async () => {
    ollama.script();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { conversation_id: "routes-3", messages: [{ role: "user", content: "   " }] },
    });
    expect(res.json().choices[0].message.content).toBe("Didn't catch that.");
    expect(ollama.requests()).toHaveLength(0);
  });

  it("rejects a body with no messages", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/chat/completions", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  // 68a8a2b. A thrown agent call used to reach the caller as a bare 500, which
  // the voice pipeline read out as "Gateway error 500".
  it("degrades to a spoken apology rather than a 500 when the model fails", async () => {
    ollama.script({ status: 500 });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { conversation_id: "routes-4", messages: [{ role: "user", content: "hello" }] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.choices[0].message.content).toBe("Something broke on my end. Try that again.");
    // And the mic closes rather than staying open after a failure.
    expect(body.continue_conversation).toBe(false);
  });
});
