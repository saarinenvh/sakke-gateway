import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../../util/validation.js";
import { weatherReadingExample, weatherReadingSchema } from "../schema.js";

describe("Open-Meteo boundary schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(weatherReadingSchema, weatherReadingExample, "Open-Meteo forecast example")).not.toThrow();
  });
});
