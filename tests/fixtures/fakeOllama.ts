import http from "http";
import type { AddressInfo } from "net";

// A scriptable stand-in for Ollama's /api/chat.
//
// A real HTTP server rather than a mocked fetch, so the code under test uses
// its own client, its own timeouts and its own error handling - the closest
// thing to production that doesn't need a GPU. Binds to 127.0.0.1 explicitly:
// Node's fetch fails fast against a "localhost"-addressed local server under
// WSL2 (IPv4/IPv6 mismatch) while curl succeeds, which has cost an hour before.
//
// Port 0, so parallel test files never collide on a fixed port.

export interface OllamaToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: Record<string, unknown> };
}

export interface ScriptedReply {
  /** Reply with tool calls instead of prose. */
  toolCalls?: OllamaToolCall[];
  /** Prose content. Ignored when toolCalls is set. */
  content?: string;
  /** Fail the request with this status instead of replying. */
  status?: number;
}

export interface RecordedRequest {
  model: string;
  /** Whether the tool schema was sent - the tools-withheld pass omits it. */
  hasTools: boolean;
  messages: { role: string; content: string }[];
  think?: boolean;
  numCtx?: number;
}

export interface FakeOllama {
  url: string;
  /** Queue the replies the agent will receive, in order. */
  script(...replies: ScriptedReply[]): void;
  /** Every agent request so far, in order. Classifier calls are excluded. */
  requests(): RecordedRequest[];
  /** What the follow-up classifier should answer. Defaults to continuation. */
  setClassifierVerdict(verdict: "continuation" | "new_request" | "noise"): void;
  close(): Promise<void>;
}

export async function startFakeOllama(): Promise<FakeOllama> {
  let queue: ScriptedReply[] = [];
  const recorded: RecordedRequest[] = [];
  let classifierVerdict: "continuation" | "new_request" | "noise" = "continuation";

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw);
      const json = (payload: unknown, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      // The follow-up classifier shares this endpoint. It sends a single user
      // message and no tools, so it's distinguishable without a separate port.
      const isClassifier =
        body.messages?.length === 1 &&
        typeof body.messages[0].content === "string" &&
        body.messages[0].content.includes("Classify the new speech");

      if (isClassifier) {
        return json({ message: { role: "assistant", content: classifierVerdict } });
      }

      recorded.push({
        model: body.model,
        hasTools: "tools" in body,
        messages: body.messages,
        think: body.think,
        numCtx: body.options?.num_ctx,
      });

      const next = queue.shift();
      if (!next) {
        return json({ error: "fake ollama: no scripted reply left" }, 500);
      }
      if (next.status && next.status !== 200) {
        res.writeHead(next.status);
        return res.end("scripted failure");
      }
      json({
        message: next.toolCalls
          ? { role: "assistant", content: "", tool_calls: next.toolCalls }
          : { role: "assistant", content: next.content ?? "" },
      });
    });
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    script: (...replies) => { queue = replies; recorded.length = 0; },
    requests: () => recorded,
    setClassifierVerdict: v => { classifierVerdict = v; },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

/** Convenience for the common single-tool-call case. */
export function toolCall(name: string, args: Record<string, unknown> = {}): OllamaToolCall {
  return { id: `call-${name}`, type: "function", function: { name, arguments: args } };
}
