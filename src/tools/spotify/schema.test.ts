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
    parseOrThrow(spotifyArgsSchema, spotifyArgsExample, "spotify args example");
    parseOrThrow(spotifyPlayerAttributesSchema, spotifyPlayerAttributesExample, "HA Spotify player attributes example");
    parseOrThrow(tokenResponseSchema, tokenResponseExample, "Spotify token example");
    parseOrThrow(searchResponseSchemaFor("tracks"), trackSearchResponseExample, "Spotify track search example");
    parseOrThrow(searchResponseSchemaFor("artists"), artistSearchResponseExample, "Spotify artist search example");
    parseOrThrow(searchResponseSchemaFor("albums"), albumSearchResponseExample, "Spotify album search example");
    parseOrThrow(searchResponseSchemaFor("playlists"), playlistSearchResponseExample, "Spotify playlist search example");
    parseOrThrow(artistAlbumsResponseSchema, artistAlbumsResponseExample, "Spotify artist albums example");
  });

  it("read stop as pause and a numeric string as a number", () => {
    expect(spotifyArgsSchema.parse({ action: "media_stop" })).toEqual({ action: "pause" });
    expect(spotifyArgsSchema.parse({ action: "volume", volume: "40" })).toEqual({ action: "volume", volume: 40 });
  });
});
