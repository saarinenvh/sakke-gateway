import { describe, it, expect } from "vitest";
import { formatWeather } from "./weather.js";

const reading = (overrides: any = {}) => ({
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

  // Finding #16. Math.max() with no arguments is -Infinity, and Sakke read out
  // "max rain chance minus Infinity percent".
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

  it("looks only at the next six hours", () => {
    // A downpour tomorrow should not show up in a six-hour outlook.
    const out = formatWeather(reading({
      hourly: { precipitation_probability: [5, 5, 5, 5, 5, 5, 99, 99] },
    }));
    expect(out).toContain("max rain chance 5%");
  });
});
