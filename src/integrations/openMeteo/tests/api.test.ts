import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../client.js", () => ({ get: mocks.get }));

import { getForecast } from "../api.js";
import { weatherReadingExample } from "../schema.js";

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue({ kind: "ok", body: weatherReadingExample });
});

describe("getForecast", () => {
  it("asks for the next six hours from now and today's summary, not the day's hours from midnight, with wind in m/s", async () => {
    await getForecast();

    const [path, query] = mocks.get.mock.calls[0];
    expect(path).toBe("/forecast");
    expect(query).toMatchObject({
      forecast_hours: "6",
      hourly: "precipitation_probability,wind_speed_10m",
      forecast_days: "1",
      wind_speed_unit: "ms",
      timezone: "auto",
    });
    expect(query.daily.split(",")).toEqual([
      "weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_sum",
      "precipitation_probability_max", "wind_speed_10m_max", "wind_gusts_10m_max",
    ]);
  });

  it("returns the reading with today's summary", async () => {
    const result = await getForecast();

    expect(result).toMatchObject({ kind: "forecast", reading: { daily: { temperature_2m_max: [13.1] } } });
  });

  it("passes the client's failure on, and fails on a reply that isn't a forecast", async () => {
    mocks.get.mockResolvedValueOnce({ kind: "failed", reason: "Open-Meteo HTTP 503" });
    await expect(getForecast()).resolves.toEqual({ kind: "failed", reason: "Open-Meteo HTTP 503" });

    mocks.get.mockResolvedValueOnce({ kind: "ok", body: { error: true, reason: "Parameter 'forecast_hours' invalid" } });
    await expect(getForecast()).resolves.toEqual({ kind: "failed", reason: "Invalid Open-Meteo forecast" });
  });
});
