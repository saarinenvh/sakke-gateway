import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../../util/validation.js";
import { getWeatherArgsExample, getWeatherArgsSchema } from "../schema.js";

describe("get_weather schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(getWeatherArgsSchema, getWeatherArgsExample, "get_weather args example")).not.toThrow();
  });
});
