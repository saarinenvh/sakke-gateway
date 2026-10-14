import http from "http";
import type { AddressInfo } from "net";
import { WebSocketServer, type WebSocket } from "ws";

// A stand-in for the slice of Home Assistant's API this service uses: the todo
// services and /api/states over REST, and todo/item/move over the WebSocket.
//
// It keeps real list state, so an operation's effect can be inspected rather
// than inferred from which calls were made - which matters for the list code,
// where the bug was that a failure part-way through destroyed data.

export interface TodoItem {
  uid?: string;
  summary: string;
  status: "needs_action" | "completed";
  due?: string;
  description?: string;
}

export interface FakeHomeAssistant {
  url: string;
  /** Replace the contents of a list. Items without a uid get one. */
  setItems(entityId: string, items: TodoItem[]): void;
  /** Current contents, in list order. */
  items(entityId: string): TodoItem[];
  /** Fail every service call and move after this many have succeeded. */
  failAfter(calls: number): void;
  /** Service calls and moves made so far, e.g. "add_item:milk", "move_item:milk". */
  calls(): string[];
  /** Every service call as {domain, service, data}, for non-todo domains too. */
  serviceCalls(): { domain: string; service: string; data: Record<string, unknown> }[];
  /** State for a single entity, returned by GET /api/states/<id>. */
  setState(entityId: string, state: string, attributes?: Record<string, unknown>): void;
  removeState(entityId: string): void;
  close(): Promise<void>;
}

export async function startFakeHomeAssistant(): Promise<FakeHomeAssistant> {
  const lists = new Map<string, TodoItem[]>();
  let callCount = 0;
  let failThreshold = Infinity;
  const callLog: string[] = [];
  const services: { domain: string; service: string; data: Record<string, unknown> }[] = [];
  const states = new Map<string, { state: string; attributes: Record<string, unknown> }>();
  let uidCount = 0;
  const newUid = () => `uid-${++uidCount}`;

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => (raw += chunk));
    req.on("end", () => {
      const url = req.url ?? "";
      const json = (payload: unknown, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      // A single entity, e.g. /api/states/remote.living_room_tv
      const singleState = url.match(/^\/api\/states\/(.+)$/);
      if (singleState) {
        const entityId = decodeURIComponent(singleState[1]);
        const known = states.get(entityId);
        if (!known) {
          res.writeHead(404);
          return res.end("Entity not found.");
        }
        return json({ entity_id: entityId, ...known });
      }

      if (url.startsWith("/api/states")) {
        return json([
          // Real HA gives a todo list's item count as its state.
          ...[...lists.entries()].map(([entity_id, items]) => ({
            entity_id,
            state: String(items.filter(i => i.status === "needs_action").length),
            attributes: { friendly_name: entity_id.replace("todo.", "") },
          })),
          ...[...states.entries()].map(([entity_id, s]) => ({ entity_id, ...s })),
        ]);
      }

      // Template rendering (the area registry): an empty render, which the
      // registry treats as "no areas" - not a todo call.
      if (url.startsWith("/api/template")) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end("");
      }

      const body = raw ? JSON.parse(raw) : {};
      const entity = body.entity_id as string;
      const items = lists.get(entity) ?? [];

      // get_items is a read; it isn't subject to the failure injection, and
      // doesn't count toward it.
      if (url.startsWith("/api/services/todo/get_items")) {
        return json({ service_response: { [entity]: { items } } });
      }

      callCount++;
      if (callCount > failThreshold) {
        res.writeHead(500);
        return res.end("fake HA: injected failure");
      }

      const service = url.match(/^\/api\/services\/([^/]+)\/([^/?]+)/);
      if (service) {
        services.push({ domain: service[1], service: service[2], data: body });
      }

      if (url.endsWith("/add_item")) {
        callLog.push(`add_item:${body.item}`);
        items.push({ uid: newUid(), summary: body.item, status: "needs_action" });
      } else if (url.endsWith("/remove_item")) {
        callLog.push(`remove_item:${body.item}`);
        const i = items.findIndex(x => x.summary === body.item);
        if (i >= 0) items.splice(i, 1);
      } else if (url.endsWith("/update_item")) {
        callLog.push(`update_item:${body.item}`);
        const item = items.find(x => x.summary === body.item);
        if (item) {
          if (body.status) item.status = body.status;
          if (body.due_date) item.due = body.due_date;
          if (body.due_datetime) item.due = body.due_datetime;
          if (body.description) item.description = body.description;
        }
      }

      // Only todo services touch a list; any other service call (vacuum.start,
      // light.turn_on) would otherwise invent a phantom list for its entity.
      if (url.startsWith("/api/services/todo/")) lists.set(entity, items);
      json({});
    });
  });

  // Like HA: auth_required on connect, auth_ok for any token, then one result
  // per command.
  const websockets = new WebSocketServer({ server, path: "/api/websocket" });
  websockets.on("connection", (socket: WebSocket) => {
    socket.send(JSON.stringify({ type: "auth_required", ha_version: "2026.10.1" }));
    socket.on("message", data => {
      const message = JSON.parse(String(data));
      if (message.type === "auth") return socket.send(JSON.stringify({ type: "auth_ok", ha_version: "2026.10.1" }));
      socket.send(JSON.stringify({ id: message.id, type: "result", ...answerCommand(message) }));
    });
  });

  function answerCommand(message: Record<string, unknown>): Record<string, unknown> {
    if (message.type !== "todo/item/move") return { success: false, error: { code: "unknown_command", message: "Unknown command." } };

    callCount++;
    if (callCount > failThreshold) return { success: false, error: { code: "home_assistant_error", message: "fake HA: injected failure" } };

    const items = lists.get(String(message.entity_id)) ?? [];
    const from = items.findIndex(i => i.uid === message.uid);
    if (from < 0) return { success: false, error: { code: "not_found", message: "Item not found" } };

    const [item] = items.splice(from, 1);
    const at = message.previous_uid === undefined ? 0 : items.findIndex(i => i.uid === message.previous_uid) + 1;
    items.splice(at, 0, item);
    callLog.push(`move_item:${item.summary}`);
    return { success: true, result: null };
  }

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    setItems: (entityId, items) => {
      lists.set(entityId, items.map(i => ({ uid: newUid(), ...i })));
      callCount = 0;
      failThreshold = Infinity;
      callLog.length = 0;
      services.length = 0;
    },
    items: entityId => lists.get(entityId) ?? [],
    serviceCalls: () => services,
    setState: (entityId, state, attributes = {}) => states.set(entityId, { state, attributes }),
    removeState: entityId => { states.delete(entityId); },
    failAfter: calls => { failThreshold = calls; },
    calls: () => callLog,
    close: async () => {
      for (const client of websockets.clients) client.terminate();
      await new Promise<void>(resolve => websockets.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
