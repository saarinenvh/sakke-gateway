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

  it("reports the cached state back", async () => {
    await app.inject({ method: "POST", url: "/internal/gpu-status", payload: { state: "busy" } });
    const res = await app.inject({ method: "GET", url: "/internal/gpu-status" });
    expect(res.json()).toMatchObject({ state: "busy", source: "auto" });
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
