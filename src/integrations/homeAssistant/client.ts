import { config } from "../../config.js";

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

export interface EntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

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

export async function haGet<T>(path: string, options?: RequestOptions): Promise<T> {
  return (await request("GET", path, undefined, options)).json() as Promise<T>;
}

export async function haPost<T>(path: string, body: unknown = {}, options?: RequestOptions): Promise<T> {
  const res = await request("POST", path, body, options);
  // Some HA endpoints answer 200 with an empty body; callers that ignore the
  // result shouldn't have to care.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function getState(entityId: string, options?: RequestOptions): Promise<EntityState> {
  return haGet<EntityState>(`/api/states/${entityId}`, options);
}

export async function getAllStates(options?: RequestOptions): Promise<EntityState[]> {
  return haGet<EntityState[]>("/api/states", options);
}

export async function callService<T = unknown>(
  domain: string,
  service: string,
  data: Record<string, unknown> = {},
  options?: RequestOptions,
): Promise<T> {
  return haPost<T>(`/api/services/${domain}/${service}`, data, options);
}

// Services that return data (todo.get_items) need return_response, and answer
// under a service_response key - except when they don't, depending on version.
export async function callServiceWithResponse<T>(
  domain: string,
  service: string,
  data: Record<string, unknown>,
  options?: RequestOptions,
): Promise<T> {
  const raw = await haPost<any>(`/api/services/${domain}/${service}?return_response=true`, data, options);
  return (raw?.service_response ?? raw) as T;
}

export async function renderTemplate(template: string, options?: RequestOptions): Promise<string> {
  return (await request("POST", "/api/template", { template }, options)).text();
}
