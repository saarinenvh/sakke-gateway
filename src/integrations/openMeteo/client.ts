// The connection to Open-Meteo: the base URL, the timeout, and a failed request or a reply that isn't
// JSON turned into a result. It knows no endpoints; api.ts does. No API key is needed.

const BASE_URL = "https://api.open-meteo.com/v1";
const TIMEOUT_MS = 5000;

export type OpenMeteoResponse = { kind: "ok"; body: unknown } | { kind: "failed"; reason: string };

/** GET `path` with `query` (each value already a string), as parsed JSON or why it failed. */
export async function get(path: string, query: Record<string, string>): Promise<OpenMeteoResponse> {
  const url = `${BASE_URL}${path}?${new URLSearchParams(query)}`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return { kind: "failed", reason: `Open-Meteo request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) return { kind: "failed", reason: `Open-Meteo HTTP ${res.status}` };

  try {
    return { kind: "ok", body: JSON.parse(await res.text()) };
  } catch {
    return { kind: "failed", reason: "Open-Meteo reply is not JSON" };
  }
}
