import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import {
  albumSearchResponseExample,
  artistAlbumsResponseExample,
  artistAlbumsResponseSchema,
  artistSearchResponseExample,
  playlistSearchResponseExample,
  searchResponseSchemaFor,
  spotifyArgsExample,
  spotifyArgsSchema,
  spotifyPlayerAttributesExample,
  spotifyPlayerAttributesSchema,
  tokenResponseExample,
  tokenResponseSchema,
  trackSearchResponseExample,
} from "./schema.js";

describe("spotify schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(spotifyArgsSchema, spotifyArgsExample, "spotify args example")).not.toThrow();
    expect(() => parseOrThrow(spotifyPlayerAttributesSchema, spotifyPlayerAttributesExample, "HA Spotify player attributes example")).not.toThrow();
    expect(() => parseOrThrow(tokenResponseSchema, tokenResponseExample, "Spotify token example")).not.toThrow();
    expect(() => parseOrThrow(searchResponseSchemaFor("tracks"), trackSearchResponseExample, "Spotify track search example")).not.toThrow();
    expect(() => parseOrThrow(searchResponseSchemaFor("artists"), artistSearchResponseExample, "Spotify artist search example")).not.toThrow();
    expect(() => parseOrThrow(searchResponseSchemaFor("albums"), albumSearchResponseExample, "Spotify album search example")).not.toThrow();
    expect(() => parseOrThrow(searchResponseSchemaFor("playlists"), playlistSearchResponseExample, "Spotify playlist search example")).not.toThrow();
    expect(() => parseOrThrow(artistAlbumsResponseSchema, artistAlbumsResponseExample, "Spotify artist albums example")).not.toThrow();
  });

  it("read stop as pause and a numeric string as a number", () => {
    expect(spotifyArgsSchema.parse({ action: "media_stop" })).toEqual({ action: "pause" });
    expect(spotifyArgsSchema.parse({ action: "volume", volume: "40" })).toEqual({ action: "volume", volume: 40 });
  });

  it("read a null source_list as no devices yet", () => {
    expect(spotifyPlayerAttributesSchema.parse({ source_list: null }).source_list ?? []).toEqual([]);
  });
});
