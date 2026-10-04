import { config } from "../../config.js";
import { parseJsonResponse } from "../../util/validation.js";
import { artistAlbumsResponseSchema, searchResponseSchemaFor, tokenResponseSchema, type SearchResultKey, type SpotifyContentType } from "./schema.js";

export type { SpotifyContentType };

export interface SpotifySearchItem { uri: string; name: string; artist?: string; id: string }

export interface SpotifyAlbum { uri: string; name: string }

let accessToken: string | null = null;
let tokenExpiry = 0;

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) throw new Error(`Spotify auth failed: ${res.status}`);
  const data = await parseJsonResponse(res, tokenResponseSchema, "Spotify token");
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return accessToken;
}

export async function searchSpotify(query: string, type: SpotifyContentType, limit: number, offset: number): Promise<SpotifySearchItem[]> {
  const token = await getAccessToken();
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}&offset=${offset}&market=FI`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Spotify search failed: ${res.status}`);
  const key: SearchResultKey = type === "playlist" ? "playlists" : type === "artist" ? "artists" : type === "album" ? "albums" : "tracks";
  const data = await parseJsonResponse(res, searchResponseSchemaFor(key), "Spotify search");
  const items = data[key].items.filter(item => item !== null);
  return items.map(item => ({
    uri: item.uri,
    name: item.name,
    artist: item.artists?.[0]?.name,
    id: item.id,
  }));
}

// /artists/{id}/top-tracks is deprecated, and editorial/algorithmic playlists
// (e.g. official "This Is ..." playlists) are no longer accessible via
// Client Credentials flow as of Spotify's Feb 2026 API changes. Get Artist's
// Albums remains a proper, active endpoint - use it instead.
export async function findArtistAlbum(artistId: string): Promise<SpotifyAlbum | null> {
  const token = await getAccessToken();
  const url = `https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=album&limit=1&market=FI`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Spotify albums fetch failed: ${res.status}`);
  const data = await parseJsonResponse(res, artistAlbumsResponseSchema, "Spotify artist albums");
  const album = data.items[0];
  if (!album) return null;
  return { uri: album.uri, name: album.name };
}
