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
    apparent_temperature: 12.4,
    wind_speed_10m: 4.6,
    wind_gusts_10m: 8.8,
    precipitation: 0,
    ...overrides.current,
  },
  hourly: {
    precipitation_probability: [10, 41, 12, 0, 0, 3],
    wind_speed_10m: [2.9, 2.5, 2.2, 1.9, 1.7, 1.4],
    ...overrides.hourly,
  },
});

const today: NonNullable<WeatherReading["daily"]> = {
  weather_code: [61], temperature_2m_max: [13.1], temperature_2m_min: [6.3], precipitation_sum: [2.4],
  precipitation_probability_max: [41], wind_speed_10m_max: [4.8], wind_gusts_10m_max: [9.4],
};

describe("formatWeather", () => {
  it("says the weather in everyday words, with no symbols or decimals", () => {
    const out = formatWeather({ ...reading(), daily: today });

    expect(out.split("\n")).toEqual([
      "Conditions: overcast",
      "Temperature: 15 degrees, feels like 12",
      "Wind: 5 meters per second, gusts up to 9",
      "Precipitation now: none",
      "Today: 6 to 13 degrees, light rain, some rain possible, wind up to 5 meters per second, gusts up to 9",
      "Next 6 hours: rain possible, wind up to 3 meters per second",
    ]);
    expect(out).not.toMatch(/°|km\/h|m\/s|mm|%|\d\.\d/);
  });

  it("leaves out the feels-like temperature when it's about the same", () => {
    expect(formatWeather(reading({ current: { apparent_temperature: 13.8 } }))).toContain("Temperature: 15 degrees\n");
  });

  it("says one meter per second in the singular", () => {
    expect(formatWeather(reading({ hourly: { wind_speed_10m: [0.8] } }))).toContain("wind up to 1 meter per second");
  });

  it("says calm instead of zero meters per second", () => {
    const out = formatWeather(reading({ current: { wind_speed_10m: 0.4, wind_gusts_10m: 0.4 }, hourly: { wind_speed_10m: [0.2] } }));
    expect(out).toContain("Wind: calm\n");
    expect(out).toContain("Next 6 hours: rain possible, calm");
  });

  it("leaves out gusts that are no stronger than the wind", () => {
    expect(formatWeather(reading({ current: { wind_speed_10m: 1.4, wind_gusts_10m: 1.2 } }))).toContain("Wind: 1 meter per second\n");
  });

  it("describes how hard it is raining now from the last 15 minutes' amount", () => {
    expect(formatWeather(reading({ current: { precipitation: 0.2 } }))).toContain("Precipitation now: light rain");
    expect(formatWeather(reading({ current: { precipitation: 1 } }))).toContain("Precipitation now: moderate rain");
    expect(formatWeather(reading({ current: { precipitation: 2.5 } }))).toContain("Precipitation now: heavy rain");
  });

  it("calls it snow when the weather code says snow, not from the temperature", () => {
    const snowing = formatWeather(reading({ current: { weather_code: 71, temperature_2m: 0.4, apparent_temperature: -3, precipitation: 0.3 } }));
    expect(snowing).toContain("Temperature: 0 degrees, feels like -3");
    expect(snowing).toContain("Precipitation now: light snow");
    expect(snowing).toContain("Next 6 hours: snow possible");

    const rainyDayFromAFrostyMorning = formatWeather({
      ...reading({ current: { temperature_2m: -1, apparent_temperature: -4 } }),
      daily: { weather_code: [63], temperature_2m_min: [-2], temperature_2m_max: [8], precipitation_sum: [6], precipitation_probability_max: [70] },
    });
    expect(rainyDayFromAFrostyMorning).toContain("Today: -2 to 8 degrees, rain, a lot of rain likely\n");
  });

  it("puts the chance of rain in words", () => {
    const chance = (percent: number) => formatWeather(reading({ hourly: { precipitation_probability: [percent] } }));
    expect(chance(10)).toContain("Next 6 hours: no rain expected");
    expect(chance(60)).toContain("Next 6 hours: rain likely");
    expect(chance(90)).toContain("Next 6 hours: rain almost certain");
  });

  it("puts today's amount of rain in words, and a dry day as no rain", () => {
    const amount = (mm: number) => formatWeather({ ...reading(), daily: { precipitation_sum: [mm], precipitation_probability_max: [85] } });
    expect(amount(0)).toContain("Today: no rain expected\n");
    expect(amount(0.4)).toContain("Today: a little rain almost certain\n");
    expect(amount(9)).toContain("Today: a lot of rain almost certain\n");
    expect(amount(20)).toContain("Today: heavy rain almost certain\n");
  });

  it("keeps a forecast amount of rain even when its chance is low", () => {
    const out = formatWeather({ ...reading(), daily: { precipitation_sum: [3], precipitation_probability_max: [10] } });
    expect(out).toContain("Today: some rain unlikely\n");
  });

  it("names the condition from the WMO code", () => {
    expect(formatWeather(reading({ current: { weather_code: 0 } }))).toContain("clear sky");
    expect(formatWeather(reading({ current: { weather_code: 95 } }))).toContain("thunderstorm");
  });

  it("degrades to the raw code for an unmapped condition", () => {
    expect(formatWeather(reading({ current: { weather_code: 42 } }))).toContain("code 42");
  });

  it("treats a missing forecast as zero rather than -Infinity", () => {
    const out = formatWeather(reading({ hourly: { precipitation_probability: undefined } }));
    expect(out).toContain("Next 6 hours: no rain expected");
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
    expect(out).toContain("Next 6 hours: no rain expected");
  });

  it("skips the null gaps Open-Meteo leaves in hourly series", () => {
    const out = formatWeather(reading({
      hourly: { precipitation_probability: [null, 30, null], wind_speed_10m: [null, null] },
    }));
    expect(out).toContain("Next 6 hours: rain possible, calm");
  });

  it("leaves out today's missing values, and the whole line when there are none", () => {
    const partial = formatWeather({ ...reading(), daily: { temperature_2m_max: [13.1], precipitation_sum: [null] } });
    expect(partial).toContain("Today: up to 13 degrees\n");

    const chanceOnly = formatWeather({ ...reading(), daily: { precipitation_sum: [null], precipitation_probability_max: [41] } });
    expect(chanceOnly).toContain("Today: rain possible\n");

    expect(formatWeather({ ...reading(), daily: {} })).not.toContain("Today");
    expect(formatWeather(reading())).not.toContain("Today");
  });
});
