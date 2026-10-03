import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../../util/validation.js";
import {
  albumSearchResponseExample,
  artistAlbumsResponseExample,
  artistAlbumsResponseSchema,
  artistSearchResponseExample,
  playlistSearchResponseExample,
  searchResponseSchemaFor,
  tokenResponseExample,
  tokenResponseSchema,
  trackSearchResponseExample,
} from "../schema.js";

describe("Spotify Web API schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(tokenResponseSchema, tokenResponseExample, "Spotify token example")).not.toThrow();
    expect(() => parseOrThrow(searchResponseSchemaFor("tracks"), trackSearchResponseExample, "Spotify track search example")).not.toThrow();
    expect(() => parseOrThrow(searchResponseSchemaFor("artists"), artistSearchResponseExample, "Spotify artist search example")).not.toThrow();
    expect(() => parseOrThrow(searchResponseSchemaFor("albums"), albumSearchResponseExample, "Spotify album search example")).not.toThrow();
    expect(() => parseOrThrow(searchResponseSchemaFor("playlists"), playlistSearchResponseExample, "Spotify playlist search example")).not.toThrow();
    expect(() => parseOrThrow(artistAlbumsResponseSchema, artistAlbumsResponseExample, "Spotify artist albums example")).not.toThrow();
  });
});
