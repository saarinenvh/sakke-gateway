import { z } from "zod";
import { config } from "../../config.js";
import { parseJsonResponse } from "../../util/validation.js";
import {
  entityStateSchema,
  entityStatesSchema,
  serviceResponseEnvelopeSchema,
  stateHistorySchema,
  todoGetItemsResponseSchemaFor,
  type EntityState,
  type TodoItem,
} from "./schema.js";

export type { EntityState };

// The one Home Assistant client: every call gets the same headers, a timeout,
// and the same error for a non-2xx answer.

// Generous enough for a service call that wakes a TV, short enough that a
// conversation turn can't hang on it. Callers that genuinely need longer pass
// their own.
const DEFAULT_TIMEOUT_MS = 10_000;

export class HaError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly method: string,
    readonly path: string,
  ) {
    // The body matters: Home Assistant explains a rejected service call there,
    // and a bare status code sent more than one debugging session the long way
    // round.
    super(`HA ${status} on ${method} ${path}${body ? `: ${body.slice(0, 500)}` : ""}`);
    this.name = "HaError";
  }
}

export interface RequestOptions {
  timeoutMs?: number;
}

export async function haGet<S extends z.ZodType>(path: string, schema: S, options?: RequestOptions): Promise<z.output<S>> {
  const res = await request("GET", path, undefined, options);
  return parseJsonResponse(res, schema, `HA GET ${path}`);
}

// For calls whose answer nobody reads. The body is still drained so the
// connection is released.
export async function haPost(path: string, body: unknown = {}, options?: RequestOptions): Promise<void> {
  const res = await request("POST", path, body, options);
  await res.text();
}

export async function getState(entityId: string, options?: RequestOptions): Promise<EntityState> {
  return haGet(`/api/states/${entityId}`, entityStateSchema, options);
}

export async function getAllStates(options?: RequestOptions): Promise<EntityState[]> {
  return haGet("/api/states", entityStatesSchema, options);
}

export interface StateChange {
  state: string;
  changedAt: number;
}

// One entity's state changes between two times, oldest first.
export async function getStateHistory(entityId: string, since: number, until: number, options?: RequestOptions): Promise<StateChange[]> {
  const query = new URLSearchParams({
    filter_entity_id: entityId,
    end_time: new Date(until).toISOString(),
    minimal_response: "",
    no_attributes: "",
  });
  const history = await haGet(`/api/history/period/${new Date(since).toISOString()}?${query}`, stateHistorySchema, options);
  return (history[0] ?? []).map(change => ({ state: change.state, changedAt: Date.parse(change.last_changed) }));
}

export async function callService(
  domain: string,
  service: string,
  data: Record<string, unknown> = {},
  options?: RequestOptions,
): Promise<void> {
  await haPost(`/api/services/${domain}/${service}`, data, options);
}

// Services that return data (todo.get_items) need return_response.
export async function callServiceWithResponse<S extends z.ZodType>(
  domain: string,
  service: string,
  data: Record<string, unknown>,
  schema: S,
  options?: RequestOptions,
): Promise<z.output<S>> {
  const path = `/api/services/${domain}/${service}?return_response=true`;
  const res = await request("POST", path, data, options);
  return parseJsonResponse(res, z.preprocess(unwrapServiceResponse, schema), `HA POST ${path}`);
}

export async function getTodoItems(entityId: string, options?: RequestOptions): Promise<TodoItem[]> {
  const response = await callServiceWithResponse("todo", "get_items", { entity_id: entityId }, todoGetItemsResponseSchemaFor(entityId), options);
  return response[entityId].items;
}

export async function renderTemplate(template: string, options?: RequestOptions): Promise<string> {
  return (await request("POST", "/api/template", { template }, options)).text();
}

async function request(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: RequestOptions = {},
): Promise<Response> {
  const res = await fetch(`${config.ha.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.ha.token}`,
      ...(body !== undefined && { "Content-Type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new HaError(res.status, await res.text().catch(() => ""), method, path);
  return res;
}

function unwrapServiceResponse(body: unknown): unknown {
  const envelope = serviceResponseEnvelopeSchema.safeParse(body);
  return envelope.success ? envelope.data.service_response : body;
}
