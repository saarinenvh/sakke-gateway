const clientId = process.env.SPOTIFY_CLIENT_ID ?? "";
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
const baseUrl = process.env.HA_BASE_URL ?? "http://localhost:8123";
const token = process.env.HA_TOKEN ?? "";

const SPOTIFY_ENTITY = "media_player.spotify_ville_saarinen";

let accessToken: string | null = null;
let tokenExpiry = 0;

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) throw new Error(`Spotify auth failed: ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return accessToken;
}

async function haService(service: string, data: Record<string, unknown>): Promise<void> {
  const [domain, action] = service.split(".");
  const res = await fetch(`${baseUrl}/api/services/${domain}/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HA ${res.status}: ${await res.text()}`);
}

export async function spotifySearch(query: string, type: "track" | "artist" | "playlist" | "album" = "track"): Promise<{ uri: string; name: string; artist?: string } | null> {
  const token = await getAccessToken();
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${type}&limit=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Spotify search failed: ${res.status}`);
  const data = await res.json() as any;

  if (type === "track") {
    const track = data.tracks?.items?.[0];
    if (!track) return null;
    return { uri: track.uri, name: track.name, artist: track.artists?.[0]?.name };
  }
  if (type === "artist") {
    const artist = data.artists?.items?.[0];
    if (!artist) return null;
    return { uri: artist.uri, name: artist.name };
  }
  if (type === "playlist") {
    const playlist = data.playlists?.items?.[0];
    if (!playlist) return null;
    return { uri: playlist.uri, name: playlist.name };
  }
  if (type === "album") {
    const album = data.albums?.items?.[0];
    if (!album) return null;
    return { uri: album.uri, name: album.name, artist: album.artists?.[0]?.name };
  }
  return null;
}

export async function spotifyPlay(uri?: string): Promise<string> {
  const data: Record<string, unknown> = { entity_id: SPOTIFY_ENTITY };
  if (uri) {
    data.media_content_id = uri;
    data.media_content_type = "music";
  }
  await haService(uri ? "media_player.play_media" : "media_player.media_play", data);
  return "Playing.";
}

export async function spotifyPause(): Promise<string> {
  await haService("media_player.media_pause", { entity_id: SPOTIFY_ENTITY });
  return "Paused.";
}

export async function spotifyNext(): Promise<string> {
  await haService("media_player.media_next_track", { entity_id: SPOTIFY_ENTITY });
  return "Next track.";
}

export async function spotifyPrevious(): Promise<string> {
  await haService("media_player.media_previous_track", { entity_id: SPOTIFY_ENTITY });
  return "Previous track.";
}

export async function spotifyVolume(pct: number): Promise<string> {
  await haService("media_player.volume_set", { entity_id: SPOTIFY_ENTITY, volume_level: pct / 100 });
  return `Volume set to ${pct}%.`;
}

export async function spotifySearchAndPlay(query: string, type: "track" | "artist" | "playlist" | "album"): Promise<string> {
  const result = await spotifySearch(query, type);
  if (!result) return `Couldn't find ${type} "${query}" on Spotify.`;
  await spotifyPlay(result.uri);
  const label = result.artist ? `${result.name} by ${result.artist}` : result.name;
  return `Playing ${label}.`;
}
