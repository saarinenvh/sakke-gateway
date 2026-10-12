import { describe, it, expect } from "vitest";
import { formatWeather } from "../weather.js";
import type { WeatherReading } from "../schema.js";

interface ReadingOverrides {
  current?: Partial<WeatherReading["current"]>;
  hourly?: Partial<WeatherReading["hourly"]>;
}

const reading = (overrides: ReadingOverrides = {}): WeatherReading => ({
  current: {
    weather_code: 3,
    temperature_2m: 14.7,
    apparent_temperature: 12.7,
    wind_speed_10m: 16.6,
    wind_gusts_10m: 31.7,
    precipitation: 0,
    ...overrides.current,
  },
  hourly: {
    precipitation_probability: [10, 41, 12, 0, 0, 3],
    wind_speed_10m: [10.4, 9, 8, 7, 6, 5],
    ...overrides.hourly,
  },
});

describe("formatWeather", () => {
  it("renders a normal reading", () => {
    const out = formatWeather(reading());
    expect(out).toContain("Conditions: overcast");
    expect(out).toContain("Temperature: 14.7°C (feels like 12.7°C)");
    expect(out).toContain("max rain chance 41%");
    expect(out).toContain("max wind 10.4 km/h");
  });

  it("names the condition from the WMO code", () => {
    expect(formatWeather(reading({ current: { weather_code: 0 } }))).toContain("clear sky");
    expect(formatWeather(reading({ current: { weather_code: 95 } }))).toContain("thunderstorm");
  });

  it("degrades to the raw code for an unmapped condition", () => {
    expect(formatWeather(reading({ current: { weather_code: 42 } }))).toContain("code 42");
  });

  it("reports zero rather than -Infinity when the forecast is missing", () => {
    const out = formatWeather(reading({ hourly: { precipitation_probability: undefined } }));
    expect(out).toContain("max rain chance 0%");
    expect(out).not.toContain("Infinity");
  });

  it("survives an empty hourly block entirely", () => {
    const out = formatWeather({ current: reading().current, hourly: {} });
    expect(out).not.toContain("Infinity");
    expect(out).not.toContain("NaN");
  });

  it("looks only at the first six hours if the series is ever longer", () => {
    const out = formatWeather(reading({
      hourly: { precipitation_probability: [5, 5, 5, 5, 5, 5, 99, 99] },
    }));
    expect(out).toContain("max rain chance 5%");
  });

  it("skips the null gaps Open-Meteo leaves in hourly series", () => {
    const out = formatWeather(reading({
      hourly: { precipitation_probability: [null, 30, null], wind_speed_10m: [null, null] },
    }));
    expect(out).toContain("max rain chance 30%");
    expect(out).toContain("max wind 0 km/h");
  });

  it("puts today's summary between the current conditions and the next hours", () => {
    const out = formatWeather({ ...reading(), daily: {
      weather_code: [61], temperature_2m_max: [13.1], temperature_2m_min: [6.3], precipitation_sum: [2.4],
      precipitation_probability_max: [41], wind_speed_10m_max: [17.2], wind_gusts_10m_max: [33.8],
    } });

    expect(out.split("\n")).toEqual([
      "Conditions: overcast",
      "Temperature: 14.7°C (feels like 12.7°C)",
      "Wind: 16.6 km/h, gusts up to 31.7 km/h",
      "Current precipitation: 0 mm",
      "Today: high 13.1°C, low 6.3°C, light rain, 2.4 mm of precipitation, max chance of precipitation 41%, wind up to 17.2 km/h, gusts 33.8 km/h",
      "Next 6h: max rain chance 41%, max wind 10.4 km/h",
    ]);
  });

  it("leaves out today's missing values, and the whole line when there are none", () => {
    const partial = formatWeather({ ...reading(), daily: { temperature_2m_max: [13.1], precipitation_sum: [null] } });
    expect(partial).toContain("Today: high 13.1°C\n");

    const chanceOnly = formatWeather({ ...reading(), daily: { precipitation_sum: [null], precipitation_probability_max: [41] } });
    expect(chanceOnly).toContain("Today: max chance of precipitation 41%\n");

    expect(formatWeather({ ...reading(), daily: {} })).not.toContain("Today");
    expect(formatWeather(reading())).not.toContain("Today");
  });
});
