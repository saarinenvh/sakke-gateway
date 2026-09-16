const clientId = process.env.SPOTIFY_CLIENT_ID ?? "";
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
const baseUrl = process.env.HA_BASE_URL ?? "http://localhost:8123";
const token = process.env.HA_TOKEN ?? "";

const SPOTIFY_ENTITY = "media_player.spotify_ville_saarinen";
const TV_REMOTE_ENTITY = "remote.living_room_tv";

// Personal/private playlists can never be found via search (Client Credentials
// flow has no user context, so it only sees public content) - and Spotify-owned
// editorial/algorithmic playlists (Discover Weekly, This Is..., etc.) lost
// search access entirely in Spotify's Feb 2026 API changes. For any playlist
// you already know the ID of, skip search and play it directly instead.
const PERSONAL_PLAYLISTS: Record<string, string> = {
  "discover weekly": "spotify:playlist:37i9dQZEVXcRBTpgpeHTpf",
  "metal": "spotify:playlist:6r8VigRsBUdBocm2aXxuGZ",
};

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Tolerates small STT mishearings (e.g. "Discovery Weekly" for "Discover Weekly")
// by allowing a short edit-distance, scaled down for short names to avoid
// false-positive matches on short/generic words.
function findPersonalPlaylist(query: string): string | null {
  const normalized = query.trim().toLowerCase();
  if (PERSONAL_PLAYLISTS[normalized]) return PERSONAL_PLAYLISTS[normalized];
  for (const [name, uri] of Object.entries(PERSONAL_PLAYLISTS)) {
    const threshold = name.length <= 6 ? 1 : 2;
    if (levenshtein(normalized, name) <= threshold) return uri;
  }
  return null;
}

let accessToken: string | null = null;
let tokenExpiry = 0;

async function getState(entityId: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/states/${entityId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HA API ${res.status}`);
  const data = await res.json() as { state: string };
  return data.state;
}

// HA's Spotify integration is Connect-based - it can only send playback to an
// already-active device, it can't activate one on its own. If something is
// already actively playing (phone/desktop/TV), leave it alone - play_media will
// just switch what's playing there. Only wake the living room TV and open
// Spotify on it when nothing is actively playing anywhere.
async function ensureActiveDevice(): Promise<void> {
  const spotifyState = await getState(SPOTIFY_ENTITY);
  if (spotifyState === "playing") return;

  const tvState = await getState(TV_REMOTE_ENTITY);
  if (tvState !== "on") {
    await haService("remote.turn_on", { entity_id: TV_REMOTE_ENTITY });
    await new Promise(r => setTimeout(r, 5000));
  }

  await haService("remote.turn_on", { entity_id: TV_REMOTE_ENTITY, activity: "spotify://" });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));
    const state = await getState(SPOTIFY_ENTITY);
    if (state === "playing" || state === "paused" || state === "idle") return;
  }
}

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

export async function spotifySearch(query: string, type: "track" | "artist" | "playlist" | "album" = "track"): Promise<{ uri: string; name: string; artist?: string; id?: string } | null> {
  const token = await getAccessToken();
  // market is required for Client Credentials flow - without it, Spotify treats
  // all content as unavailable and returns empty results.
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${type}&limit=1&market=FI`;
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
    return { uri: artist.uri, name: artist.name, id: artist.id };
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

// /artists/{id}/top-tracks is deprecated, and editorial/algorithmic playlists
// (e.g. official "This Is ..." playlists) are no longer accessible via
// Client Credentials flow as of Spotify's Feb 2026 API changes. Get Artist's
// Albums remains a proper, active endpoint - use it instead.
async function spotifyArtistAlbum(artistId: string): Promise<{ uri: string; name: string } | null> {
  const token = await getAccessToken();
  const url = `https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=album&limit=1&market=FI`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Spotify albums fetch failed: ${res.status}`);
  const data = await res.json() as any;
  const album = data.items?.[0];
  if (!album) return null;
  return { uri: album.uri, name: album.name };
}

export async function spotifyPlay(uri?: string, type?: "track" | "artist" | "playlist" | "album"): Promise<string> {
  await ensureActiveDevice();
  const data: Record<string, unknown> = { entity_id: SPOTIFY_ENTITY };
  if (uri) {
    data.media_content_id = uri;
    // Must match the URI's actual type (spotify:track:.../spotify:playlist:...) -
    // a mismatched type (e.g. always "music") causes HA's Spotify integration to
    // open the app without loading the content, silently.
    data.media_content_type = type ?? "track";
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
  const personalUri = findPersonalPlaylist(query);
  if (personalUri) {
    await spotifyPlay(personalUri, "playlist");
    return `Playing ${query}.`;
  }

  // HA's Spotify integration doesn't support media_content_type "artist" for
  // play_media (errors with a generic 500), and editorial/algorithmic playlists
  // (e.g. official "This Is ..." playlists) are no longer accessible via
  // Client Credentials flow as of Spotify's Feb 2026 API changes. For an artist
  // request, resolve them to an artist ID then play one of their albums
  // instead - proper catalog content, doesn't need an exact song name.
  if (type === "artist") {
    const artist = await spotifySearch(query, "artist");
    if (!artist?.id) return `Couldn't find artist "${query}" on Spotify.`;
    const album = await spotifyArtistAlbum(artist.id);
    if (!album) return `Found ${artist.name} but couldn't find an album to play.`;
    await spotifyPlay(album.uri, "album");
    return `Playing ${album.name} by ${artist.name}.`;
  }

  const result = await spotifySearch(query, type);
  if (!result) return `Couldn't find ${type} "${query}" on Spotify.`;
  await spotifyPlay(result.uri, type);
  const label = result.artist ? `${result.name} by ${result.artist}` : result.name;
  return `Playing ${label}.`;
}
