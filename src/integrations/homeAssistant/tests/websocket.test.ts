import { describe, it, expect, vi, afterEach } from "vitest";
import { ValidationError } from "../../../util/validation.js";
import { config } from "../../../config.js";
import { moveTodoItems } from "../client.js";
import { HaWebSocketError, sendCommands } from "../websocket.js";

type Message = Record<string, unknown>;

// How the fake HA answers one message the gateway sends: the messages to send
// back, or nothing to stay silent.
type Answer = (sent: Message) => unknown[];

// A stand-in for the global WebSocket that plays Home Assistant's side.
class FakeHaSocket extends EventTarget {
  static answer: Answer;
  static greeting: unknown = { type: "auth_required", ha_version: "2026.10.1" };
  static instances: FakeHaSocket[] = [];

  readonly sent: Message[] = [];
  closed = false;

  constructor(readonly url: string) {
    super();
    FakeHaSocket.instances.push(this);
    setTimeout(() => this.receive(FakeHaSocket.greeting));
  }

  send(data: string): void {
    const message = JSON.parse(data) as Message;
    this.sent.push(message);
    for (const reply of FakeHaSocket.answer(message)) setTimeout(() => this.receive(reply));
  }

  close(): void {
    this.closed = true;
  }

  dropConnection(): void {
    this.dispatchEvent(Object.assign(new Event("close"), { code: 1006 }));
  }

  private receive(message: unknown): void {
    const data = typeof message === "string" ? message : JSON.stringify(message);
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

function okResult(id: unknown): Message {
  return { id, type: "result", success: true, result: null };
}

// HA as it behaves for a valid token: auth_ok, then every command succeeds.
const healthyHa: Answer = sent => (sent.type === "auth" ? [{ type: "auth_ok", ha_version: "2026.10.1" }] : [okResult(sent.id)]);

function useFakeHa(answer: Answer = healthyHa): void {
  FakeHaSocket.answer = answer;
  FakeHaSocket.greeting = { type: "auth_required", ha_version: "2026.10.1" };
  FakeHaSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeHaSocket);
}

function lastSocket(): FakeHaSocket {
  const socket = FakeHaSocket.instances.at(-1);
  if (!socket) throw new Error("no connection was opened");
  return socket;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendCommands", () => {
  it("authenticates with the HA token, then sends the commands in order with increasing ids", async () => {
    useFakeHa();

    await sendCommands([{ type: "first" }, { type: "second", value: 2 }]);

    expect(lastSocket().sent).toEqual([
      { type: "auth", access_token: config.ha.token },
      { type: "first", id: 1 },
      { type: "second", value: 2, id: 2 },
    ]);
    expect(lastSocket().closed).toBe(true);
  });

  it("connects to /api/websocket under the base URL, ws for http and wss for https", async () => {
    useFakeHa();
    const original = config.ha.baseUrl;

    try {
      config.ha.baseUrl = "http://ha.local:8123";
      await sendCommands([]);
      expect(lastSocket().url).toBe("ws://ha.local:8123/api/websocket");

      config.ha.baseUrl = "https://ha.example.com";
      await sendCommands([]);
      expect(lastSocket().url).toBe("wss://ha.example.com/api/websocket");

      config.ha.baseUrl = "https://example.com/ha";
      await sendCommands([]);
      expect(lastSocket().url).toBe("wss://example.com/ha/api/websocket");
    } finally {
      config.ha.baseUrl = original;
    }
  });

  it("fails with HA's reason when the token is rejected, and sends no command", async () => {
    useFakeHa(sent => (sent.type === "auth" ? [{ type: "auth_invalid", message: "Invalid access token or password" }] : []));

    await expect(sendCommands([{ type: "first" }])).rejects.toThrow("token rejected: Invalid access token or password");
    expect(lastSocket().sent.map(message => message.type)).toEqual(["auth"]);
    expect(lastSocket().closed).toBe(true);
  });

  it("stops at the first command HA rejects and reports its error", async () => {
    useFakeHa(sent => {
      if (sent.type === "auth") return [{ type: "auth_ok" }];
      if (sent.id === 2) return [{ id: 2, type: "result", success: false, error: { code: "not_found", message: "Unable to find item" } }];
      return [okResult(sent.id)];
    });

    const error = await sendCommands([{ type: "first" }, { type: "second" }, { type: "third" }]).catch(err => err);

    expect(error).toBeInstanceOf(HaWebSocketError);
    expect(error.message).toContain("second failed: not_found: Unable to find item");
    expect(lastSocket().sent.map(message => message.type)).toEqual(["auth", "first", "second"]);
  });

  it("rejects an answer that belongs to another command", async () => {
    useFakeHa(sent => (sent.type === "auth" ? [{ type: "auth_ok" }] : [okResult(99)]));

    await expect(sendCommands([{ type: "first" }])).rejects.toThrow("answer to command 99 arrived while waiting for 1");
  });

  it("times out when HA doesn't answer", async () => {
    useFakeHa(sent => (sent.type === "auth" ? [{ type: "auth_ok" }] : []));

    await expect(sendCommands([{ type: "first" }], { timeoutMs: 20 })).rejects.toThrow("no answer in 20 ms");
    expect(lastSocket().closed).toBe(true);
  });

  it("fails when the connection drops while waiting", async () => {
    useFakeHa(sent => {
      if (sent.type === "auth") return [{ type: "auth_ok" }];
      setTimeout(() => lastSocket().dropConnection());
      return [];
    });

    await expect(sendCommands([{ type: "first" }])).rejects.toThrow("connection closed (1006)");
  });

  it("names the address when the connection can't be made", async () => {
    useFakeHa();
    vi.stubGlobal("WebSocket", class extends FakeHaSocket {
      constructor(url: string) {
        super(url);
        setTimeout(() => {
          this.dispatchEvent(new Event("error"));
          this.dropConnection();
        });
      }
    });
    const original = config.ha.baseUrl;

    try {
      config.ha.baseUrl = "http://wrong-host:8123";
      await expect(sendCommands([{ type: "first" }])).rejects.toThrow("HA WebSocket: connection to ws://wrong-host:8123/api/websocket failed");
    } finally {
      config.ha.baseUrl = original;
    }
  });

  it("treats a message that isn't JSON as a validation failure", async () => {
    useFakeHa();
    FakeHaSocket.greeting = "<html>502 Bad Gateway</html>";

    await expect(sendCommands([{ type: "first" }])).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("moveTodoItems", () => {
  it("sends one todo/item/move per move over a single connection, leaving previous_uid out for the top", async () => {
    useFakeHa();

    await moveTodoItems("todo.shopping_list", [
      { uid: "milk", previousUid: undefined },
      { uid: "bread", previousUid: "milk" },
    ]);

    expect(FakeHaSocket.instances).toHaveLength(1);
    expect(lastSocket().sent.slice(1)).toEqual([
      { type: "todo/item/move", entity_id: "todo.shopping_list", uid: "milk", id: 1 },
      { type: "todo/item/move", entity_id: "todo.shopping_list", uid: "bread", previous_uid: "milk", id: 2 },
    ]);
  });

  it("opens no connection when there is nothing to move", async () => {
    useFakeHa();

    await moveTodoItems("todo.shopping_list", []);

    expect(FakeHaSocket.instances).toHaveLength(0);
  });
});
