import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { callServiceWithResponse, getAllStates, getState, HaError, HaInvalidResponseError } from "./client.js";

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("entity state reads", () => {
  it("returns a validated state, keeping attributes but dropping unused top-level fields", async () => {
    respondWith({
      entity_id: "light.ceiling",
      state: "on",
      attributes: { friendly_name: "Ceiling", brightness: 120 },
      last_changed: "2026-09-27T10:00:00Z",
    });

    await expect(getState("light.ceiling")).resolves.toEqual({
      entity_id: "light.ceiling",
      state: "on",
      attributes: { friendly_name: "Ceiling", brightness: 120 },
    });
  });

  it("rejects a states list where an entity is missing its state", async () => {
    respondWith([{ entity_id: "light.ceiling", attributes: {} }]);

    await expect(getAllStates()).rejects.toBeInstanceOf(HaInvalidResponseError);
  });

  it("keeps an HTTP failure an HaError, not a validation error", async () => {
    respondWith({ message: "Entity not found." }, 404);

    await expect(getState("light.missing")).rejects.toBeInstanceOf(HaError);
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
    expect(error).toBeInstanceOf(HaInvalidResponseError);
    expect(error.path).toBe("/api/services/todo/get_items?return_response=true");
    expect(error.issues).toContain("items");
  });
});
