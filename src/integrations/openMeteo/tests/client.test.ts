import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "../client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(respond: () => Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(respond);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Open-Meteo client", () => {
  it("GETs the path under the base URL with the query, and returns the JSON", async () => {
    const fetchMock = stubFetch(async () => new Response(JSON.stringify({ ok: 1 })));

    await expect(get("/forecast", { latitude: "60.1", forecast_hours: "6" })).resolves.toEqual({ kind: "ok", body: { ok: 1 } });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.open-meteo.com/v1/forecast?latitude=60.1&forecast_hours=6");
  });

  it("turns a network error, an HTTP error and a reply that isn't JSON into a failure", async () => {
    stubFetch(async () => { throw new Error("timeout"); });
    await expect(get("/forecast", {})).resolves.toEqual({ kind: "failed", reason: "Open-Meteo request failed: timeout" });

    stubFetch(async () => new Response("down", { status: 503 }));
    await expect(get("/forecast", {})).resolves.toEqual({ kind: "failed", reason: "Open-Meteo HTTP 503" });

    stubFetch(async () => new Response("<html>"));
    await expect(get("/forecast", {})).resolves.toEqual({ kind: "failed", reason: "Open-Meteo reply is not JSON" });
  });
});
