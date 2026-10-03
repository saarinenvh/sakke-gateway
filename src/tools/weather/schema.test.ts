import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import { getWeatherArgsExample, getWeatherArgsSchema, weatherReadingExample, weatherReadingSchema } from "./schema.js";

describe("get_weather schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(getWeatherArgsSchema, getWeatherArgsExample, "get_weather args example")).not.toThrow();
    expect(() => parseOrThrow(weatherReadingSchema, weatherReadingExample, "Open-Meteo forecast example")).not.toThrow();
  });
});
