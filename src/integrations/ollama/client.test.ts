import { describe, it, expect, afterEach } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { ollamaChat, OllamaError, type OllamaChatRequest } from "./client.js";
import { ValidationError } from "../../util/validation.js";

// A real HTTP server rather than a mocked fetch, matching fakeOllama.ts's own
// rationale - this exercises ollamaChat's actual fetch/parse path.
async function startServer(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

let server: Awaited<ReturnType<typeof startServer>> | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const REQUEST: OllamaChatRequest = {
  model: "test-model",
  messages: [{ role: "user", content: "hi" }],
  options: {},
};

async function expectRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected ollamaChat to throw");
}

describe("ollamaChat", () => {
  it("returns the parsed message on a valid response", async () => {
    server = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: { role: "assistant", content: "hi there" } }));
    });

    const message = await ollamaChat(server.url, REQUEST);
    expect(message).toEqual({ role: "assistant", content: "hi there" });
  });

  it("throws an OllamaError carrying the status and body on a non-2xx status", async () => {
    server = await startServer((req, res) => {
      res.writeHead(500);
      res.end("model not found");
    });

    const err = await expectRejection(ollamaChat(server.url, REQUEST));
    expect(err).toBeInstanceOf(OllamaError);
    expect(err).toMatchObject({ status: 500, body: "model not found" });
  });

  // res.json() throws SyntaxError on malformed JSON, which used to escape as a
  // bare error - continuationCheck.ts would then log "unreachable" instead of
  // "invalid response" for a request that actually reached Ollama fine.
  it("throws a ValidationError when the body isn't valid JSON", async () => {
    server = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("not json");
    });

    const err = await expectRejection(ollamaChat(server.url, REQUEST));
    expect(err).toBeInstanceOf(ValidationError);
  });

  it("throws a ValidationError when the body doesn't match the schema", async () => {
    server = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: { role: "assistant" } })); // missing content
    });

    const err = await expectRejection(ollamaChat(server.url, REQUEST));
    expect(err).toBeInstanceOf(ValidationError);
  });
});
