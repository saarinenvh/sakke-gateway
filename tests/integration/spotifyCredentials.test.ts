import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { startFakeHomeAssistant, type FakeHomeAssistant } from "../fixtures/fakeHomeAssistant.js";
import { reloadConfig } from "../../src/config.js";

// Regression coverage for the bug where Spotify API requests sent
// config.ha.token instead of the token Spotify itself issued
// (getAccessToken() was called, its result just never used). Distinct fake
// credentials for each integration, and asserting on the actual outgoing
// header, is exactly what would have caught it - the previous test file only
// covered findPersonalPlaylist's string matching, never a real request.
//
// Spotify's own domains (accounts.spotify.com, api.spotify.com) are
// intercepted directly on global fetch, since spotify.ts hardcodes them
// rather than reading a configurable base URL the way the HA client does.
// Anything else (HA calls) falls through to the real fetch, which reaches
// the fake HA server below.

const HA_TOKEN = "FAKE_HA_TOKEN";
const SPOTIFY_TOKEN = "FAKE_SPOTIFY_TOKEN";

let ha: FakeHomeAssistant;
let realFetch: typeof fetch;
const spotifyAuthHeaders: { url: string; auth: string | null }[] = [];

function fakeSpotifyResponse(url: string): Response | null {
  if (url.startsWith("https://accounts.spotify.com/api/token")) {
    return new Response(JSON.stringify({ access_token: SPOTIFY_TOKEN, expires_in: 3600 }), { status: 200 });
  }
  if (url.startsWith("https://api.spotify.com/v1/search")) {
    const type = new URL(url).searchParams.get("type");
    const key = type === "artist" ? "artists" : type === "album" ? "albums" : type === "playlist" ? "playlists" : "tracks";
    return new Response(JSON.stringify({
      [key]: { items: [{ uri: "spotify:track:1", id: "artist1", name: "Ensiferum", artists: [{ name: "Ensiferum" }] }] },
    }), { status: 200 });
  }
  if (url.match(/^https:\/\/api\.spotify\.com\/v1\/artists\/.+\/albums/)) {
    return new Response(JSON.stringify({ items: [{ uri: "spotify:album:1", name: "From Afar" }] }), { status: 200 });
  }
  return null;
}

beforeAll(async () => {
  ha = await startFakeHomeAssistant();
  process.env.HA_BASE_URL = ha.url;
  process.env.HA_TOKEN = HA_TOKEN;
  process.env.SPOTIFY_CLIENT_ID = "fake-client-id";
  process.env.SPOTIFY_CLIENT_SECRET = "fake-client-secret";
  reloadConfig();

  realFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("https://accounts.spotify.com") || url.startsWith("https://api.spotify.com")) {
      if (!url.includes("/api/token")) {
        const auth = (init?.headers as Record<string, string> | undefined)?.["Authorization"] ?? null;
        spotifyAuthHeaders.push({ url, auth });
      }
      const res = fakeSpotifyResponse(url);
      if (res) return res;
    }
    return realFetch(input, init);
  }) as typeof fetch;

  // Playing already, so ensureActiveDevice (used by the artist->album->play
  // path) returns immediately instead of running its TV-wake dance.
  ha.setState("media_player.spotify_ville_saarinen", "playing");
});

afterAll(async () => {
  global.fetch = realFetch;
  await ha.close();
  delete process.env.HA_BASE_URL;
  delete process.env.HA_TOKEN;
  delete process.env.SPOTIFY_CLIENT_ID;
  delete process.env.SPOTIFY_CLIENT_SECRET;
  reloadConfig();
});

beforeEach(() => {
  spotifyAuthHeaders.length = 0;
  vi.clearAllMocks();
});

describe("Spotify requests carry Spotify's own token, not Home Assistant's", () => {
  it("search (spotifySuggest) sends the Spotify access token", async () => {
    const { spotifySuggest } = await import("../../src/spotify/spotify.js");
    await spotifySuggest("cred-test-search", "ensiferum", "track", 0);

    expect(spotifyAuthHeaders).toHaveLength(1);
    expect(spotifyAuthHeaders[0].url).toContain("/v1/search");
    expect(spotifyAuthHeaders[0].auth).toBe(`Bearer ${SPOTIFY_TOKEN}`);
    expect(spotifyAuthHeaders[0].auth).not.toContain(HA_TOKEN);
  });

  it("artist album lookup (via the suggest-then-pick flow) sends the Spotify access token", async () => {
    const { spotifySuggest, spotifyPlayIndexed } = await import("../../src/spotify/spotify.js");
    await spotifySuggest("cred-test-artist", "ensiferum", "artist", 0);
    await spotifyPlayIndexed("cred-test-artist", 1);

    const albumCall = spotifyAuthHeaders.find(h => h.url.includes("/albums"));
    expect(albumCall).toBeDefined();
    expect(albumCall!.auth).toBe(`Bearer ${SPOTIFY_TOKEN}`);
    expect(albumCall!.auth).not.toContain(HA_TOKEN);
  });
});
