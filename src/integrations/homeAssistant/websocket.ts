import { z } from "zod";
import { config } from "../../config.js";
import { parseJsonText } from "../../util/validation.js";
import type { RequestOptions } from "./client.js";
import { authMessageSchema, commandResultSchema } from "./schema.js";

// Home Assistant's WebSocket API, for the commands its REST API lacks
// (todo/item/move). Each call is one short-lived connection: open,
// authenticate, send the commands in order, close.

// Applies to each answer separately, so a batch of commands isn't cut short
// just for being long.
const DEFAULT_TIMEOUT_MS = 10_000;

export class HaWebSocketError extends Error {
  constructor(message: string) {
    super(`HA WebSocket: ${message}`);
    this.name = "HaWebSocketError";
  }
}

export interface HaCommand {
  type: string;
  [field: string]: unknown;
}

// Stops at the first command HA rejects; the ones before it have taken effect.
export async function sendCommands(commands: HaCommand[], { timeoutMs = DEFAULT_TIMEOUT_MS }: RequestOptions = {}): Promise<void> {
  const url = websocketUrl(config.ha.baseUrl);
  const socket = new WebSocket(url);
  const nextMessage = openInbox(socket, url, timeoutMs);

  try {
    await authenticate(socket, nextMessage);

    for (const [index, command] of commands.entries()) {
      const id = index + 1;
      socket.send(JSON.stringify({ ...command, id }));

      const result = parseJsonText(await nextMessage(), commandResultSchema, `HA WebSocket ${command.type}`);
      checkResult(result, id, command.type);
    }
  } finally {
    socket.close();
  }
}

// Joined like the REST client's paths, so a base URL with a path (HA behind a
// proxy) keeps it.
function websocketUrl(baseUrl: string): string {
  const url = new URL(`${baseUrl}/api/websocket`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

async function authenticate(socket: WebSocket, nextMessage: () => Promise<string>): Promise<void> {
  const greeting = parseAuthMessage(await nextMessage());
  if (greeting.type !== "auth_required") throw new HaWebSocketError(`expected auth_required, got ${greeting.type}`);

  socket.send(JSON.stringify({ type: "auth", access_token: config.ha.token }));

  const answer = parseAuthMessage(await nextMessage());
  if (answer.type === "auth_invalid") throw new HaWebSocketError(`token rejected: ${answer.message ?? "no reason given"}`);
  if (answer.type !== "auth_ok") throw new HaWebSocketError(`expected auth_ok, got ${answer.type}`);
}

function parseAuthMessage(text: string): z.output<typeof authMessageSchema> {
  return parseJsonText(text, authMessageSchema, "HA WebSocket auth");
}

function checkResult(result: z.output<typeof commandResultSchema>, id: number, type: string): void {
  if (result.id !== id) throw new HaWebSocketError(`answer to command ${result.id} arrived while waiting for ${id}`);
  if (!result.success) {
    throw new HaWebSocketError(`${type} failed: ${result.error?.code ?? "unknown"}: ${result.error?.message ?? ""}`);
  }
}

// The messages in arrival order. Without subscriptions HA sends nothing but the
// handshake and one answer per command, so the next message is always the one
// the caller is waiting for.
function openInbox(socket: WebSocket, url: string, timeoutMs: number): () => Promise<string> {
  const arrived: string[] = [];
  let failure: HaWebSocketError | undefined;
  let wake: (() => void) | undefined;

  socket.addEventListener("message", event => {
    arrived.push(String(event.data));
    wake?.();
  });
  socket.addEventListener("error", () => {
    // The event carries no reason, so name the address: a wrong HA_BASE_URL
    // is the usual cause.
    failure ??= new HaWebSocketError(`connection to ${url} failed`);
    wake?.();
  });
  socket.addEventListener("close", event => {
    failure ??= new HaWebSocketError(`connection closed (${event.code})`);
    wake?.();
  });

  function waitForEvent(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new HaWebSocketError(`no answer in ${timeoutMs} ms`)), timeoutMs);
      wake = () => {
        clearTimeout(timer);
        wake = undefined;
        resolve();
      };
    });
  }

  return async function nextMessage(): Promise<string> {
    while (arrived.length === 0) {
      if (failure) throw failure;
      await waitForEvent();
    }
    return arrived.shift() ?? "";
  };
}
