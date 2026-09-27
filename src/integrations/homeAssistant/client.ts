import { z } from "zod";
import { config } from "../../config.js";
import { entityStateSchema, entityStatesSchema, type EntityState } from "./schemas.js";

export type { EntityState };

// One Home Assistant client.
//
// There used to be eight: registry, dispatcher, lists, reminders, scenes,
// spotify, timerAnnouncer and executor each built their own fetch, with their
// own headers, their own timeout (5s, 8s, 10s, 15s, or none) and their own idea
// of what an error looks like - some threw `HA API ${status}`, some included
// the body, some threw nothing at all because they never checked res.ok.
//
// A disproportionate share of the code review's findings lived in that
// duplication: the area-id bug, the due-date bug, the list rewrite, and most of
// the missing timeouts.

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

// HA accepted the request but answered with a body of the wrong shape. Kept
// apart from HaError because there is no status to report, and the usual
// cause is an HA version change rather than a rejected call.
export class HaInvalidResponseError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly issues: string,
  ) {
    super(`HA returned an unexpected response on ${method} ${path}: ${issues}`);
    this.name = "HaInvalidResponseError";
  }
}

export interface RequestOptions {
  timeoutMs?: number;
}

// Newer HA versions wrap a service's data as { changed_states, service_response };
// older ones return the data bare.
const serviceResponseEnvelopeSchema = z.object({
  service_response: z.record(z.string(), z.unknown()),
});

export async function haGet<S extends z.ZodType>(path: string, schema: S, options?: RequestOptions): Promise<z.output<S>> {
  const res = await request("GET", path, undefined, options);
  return parseResponse(schema, await res.json(), "GET", path);
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
  return parseResponse(schema, unwrapServiceResponse(await res.json()), "POST", path);
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

function parseResponse<S extends z.ZodType>(schema: S, body: unknown, method: string, path: string): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HaInvalidResponseError(method, path, z.prettifyError(parsed.error));
  return parsed.data;
}
