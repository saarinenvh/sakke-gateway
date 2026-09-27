import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { ValidationError } from "../../util/validation.js";
import { callServiceWithResponse, getAllStates, getState, getStateHistory, getTodoItems, HaError } from "./client.js";

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("entity state reads", () => {
  it("returns a validated state, keeping attributes and last_changed but dropping unused top-level fields", async () => {
    respondWith({
      entity_id: "light.ceiling",
      state: "on",
      attributes: { friendly_name: "Ceiling", brightness: 120 },
      last_changed: "2026-09-27T10:00:00Z",
      last_reported: "2026-09-27T10:05:00Z",
    });

    await expect(getState("light.ceiling")).resolves.toEqual({
      entity_id: "light.ceiling",
      state: "on",
      attributes: { friendly_name: "Ceiling", brightness: 120 },
      last_changed: "2026-09-27T10:00:00Z",
    });
  });

  it("rejects a states list where an entity is missing its state", async () => {
    respondWith([{ entity_id: "light.ceiling", attributes: {} }]);

    await expect(getAllStates()).rejects.toBeInstanceOf(ValidationError);
  });

  it("treats a truncated 2xx body as a validation failure, not a crash in JSON parsing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('[{"entity_id": "light.ceil', { status: 200 })));

    const error = await getAllStates().catch(err => err);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.issues).toContain("body is not JSON");
  });

  it("keeps an HTTP failure an HaError, not a validation error", async () => {
    respondWith({ message: "Entity not found." }, 404);

    await expect(getState("light.missing")).rejects.toBeInstanceOf(HaError);
  });
});

describe("getStateHistory", () => {
  it("returns one entity's changes, oldest first, as timestamps", async () => {
    respondWith([[
      { entity_id: "vacuum.robot", state: "cleaning", last_changed: "2026-09-27T17:05:39+00:00", attributes: {} },
      { state: "returning", last_changed: "2026-09-27T17:18:37+00:00" },
    ]]);

    await expect(getStateHistory("vacuum.robot", 0, 1)).resolves.toEqual([
      { state: "cleaning", changedAt: Date.parse("2026-09-27T17:05:39+00:00") },
      { state: "returning", changedAt: Date.parse("2026-09-27T17:18:37+00:00") },
    ]);
  });

  it("returns nothing when HA has no history for the entity", async () => {
    respondWith([]);
    await expect(getStateHistory("vacuum.robot", 0, 1)).resolves.toEqual([]);
  });
});

describe("callServiceWithResponse", () => {
  const itemsSchema = z.record(z.string(), z.object({ items: z.array(z.string()) }));

  it("unwraps the service_response envelope newer HA versions send", async () => {
    respondWith({ changed_states: [], service_response: { "todo.shopping": { items: ["milk"] } } });

    await expect(callServiceWithResponse("todo", "get_items", {}, itemsSchema))
      .resolves.toEqual({ "todo.shopping": { items: ["milk"] } });
  });

  it("accepts the bare response older HA versions send", async () => {
    respondWith({ "todo.shopping": { items: ["milk"] } });

    await expect(callServiceWithResponse("todo", "get_items", {}, itemsSchema))
      .resolves.toEqual({ "todo.shopping": { items: ["milk"] } });
  });

  it("names the request and the mismatch when the response has the wrong shape", async () => {
    respondWith({ service_response: { "todo.shopping": { items: "milk" } } });

    const error = await callServiceWithResponse("todo", "get_items", {}, itemsSchema).catch(err => err);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.source).toBe("HA POST /api/services/todo/get_items?return_response=true");
    expect(error.issues).toContain("items");
  });
});

describe("getTodoItems", () => {
  it("returns the requested list's items", async () => {
    respondWith({ service_response: { "todo.shopping": { items: [{ summary: "milk", status: "needs_action" }] } } });

    await expect(getTodoItems("todo.shopping")).resolves.toEqual([{ summary: "milk", status: "needs_action" }]);
  });

  it.each([
    ["the requested entity is missing", { service_response: { "todo.other": { items: [] } } }],
    ["the entity has no items field", { service_response: { "todo.shopping": {} } }],
  ])("rejects a response where %s, instead of reporting an empty list", async (_case, body) => {
    respondWith(body);

    await expect(getTodoItems("todo.shopping")).rejects.toBeInstanceOf(ValidationError);
  });
});
