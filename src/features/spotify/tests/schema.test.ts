import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../../util/validation.js";
import { spotifyPlayerAttributesExample, spotifyPlayerAttributesSchema } from "../schema.js";

describe("spotify player schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(spotifyPlayerAttributesSchema, spotifyPlayerAttributesExample, "HA Spotify player attributes example")).not.toThrow();
  });

  it("read a null source_list as no devices yet", () => {
    expect(spotifyPlayerAttributesSchema.parse({ source_list: null }).source_list ?? []).toEqual([]);
  });
});
