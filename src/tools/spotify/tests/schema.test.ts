import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../../util/validation.js";
import { spotifyArgsExample, spotifyArgsSchema } from "../schema.js";

describe("spotify schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(spotifyArgsSchema, spotifyArgsExample, "spotify args example")).not.toThrow();
  });

  it("read stop as pause and a numeric string as a number", () => {
    expect(spotifyArgsSchema.parse({ action: "media_stop" })).toEqual({ action: "pause" });
    expect(spotifyArgsSchema.parse({ action: "volume", volume: "40" })).toEqual({ action: "volume", volume: 40 });
  });
});
