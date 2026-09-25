import http from "http";
import type { AddressInfo } from "net";

// A stand-in for the slice of Home Assistant's REST API this service uses:
// the todo services, and /api/states.
//
// It keeps real list state, so an operation's effect can be inspected rather
// than inferred from which calls were made - which matters for the list code,
// where the bug was that a failure part-way through destroyed data.

export interface TodoItem {
  summary: string;
  status: "needs_action" | "completed";
  due?: string;
  description?: string;
}

export interface FakeHomeAssistant {
  url: string;
  /** Replace the contents of a list. */
  setItems(entityId: string, items: TodoItem[]): void;
  /** Current contents, in list order. */
  items(entityId: string): TodoItem[];
  /** Fail every service call after this many have succeeded. */
  failAfter(calls: number): void;
  /** Service calls made so far, e.g. "add_item:milk". */
  calls(): string[];
  close(): Promise<void>;
}

export async function startFakeHomeAssistant(): Promise<FakeHomeAssistant> {
  const lists = new Map<string, TodoItem[]>();
  let callCount = 0;
  let failThreshold = Infinity;
  const callLog: string[] = [];

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => (raw += chunk));
    req.on("end", () => {
      const url = req.url ?? "";
      const json = (payload: unknown, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (url.startsWith("/api/states")) {
        return json([...lists.keys()].map(entity_id => ({
          entity_id,
          attributes: { friendly_name: entity_id.replace("todo.", "") },
        })));
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

      if (url.endsWith("/add_item")) {
        callLog.push(`add_item:${body.item}`);
        items.push({ summary: body.item, status: "needs_action" });
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

      lists.set(entity, items);
      json({});
    });
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    setItems: (entityId, items) => {
      lists.set(entityId, items.map(i => ({ ...i })));
      callCount = 0;
      failThreshold = Infinity;
      callLog.length = 0;
    },
    items: entityId => lists.get(entityId) ?? [],
    failAfter: calls => { failThreshold = calls; },
    calls: () => callLog,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
