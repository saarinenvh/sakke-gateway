const clientId = process.env.SPOTIFY_CLIENT_ID ?? "";
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
const baseUrl = process.env.HA_BASE_URL ?? "http://localhost:8123";
const token = process.env.HA_TOKEN ?? "";

const SPOTIFY_ENTITY = "media_player.spotify_ville_saarinen";
const TV_REMOTE_ENTITY = "remote.living_room_tv";
// Name the TV shows up as in Spotify Connect's device list (media_player.select_source).
const SPOTIFY_TV_SOURCE = "Tv";

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

const FILLER_WORDS = /\b(playlist|song|track|please|the)\b/g;

// Tolerates small STT mishearings (e.g. "Discovery Weekly" for "Discover Weekly")
// and filler words the model tacks on (e.g. "metal playlist" for "metal") by
// stripping them before comparing, with a short edit-distance allowed on top,
// scaled down for short names to avoid false-positive matches on short/generic words.
function findPersonalPlaylist(query: string): string | null {
  const normalized = query.trim().toLowerCase().replace(FILLER_WORDS, "").replace(/\s+/g, " ").trim();
  if (PERSONAL_PLAYLISTS[normalized]) return PERSONAL_PLAYLISTS[normalized];
  for (const [name, uri] of Object.entries(PERSONAL_PLAYLISTS)) {
    const threshold = name.length <= 6 ? 1 : 2;
    if (levenshtein(normalized, name) <= threshold) return uri;
  }
  return null;
}

let accessToken: string | null = null;
let tokenExpiry = 0;

async function getEntity(entityId: string): Promise<{ state: string; attributes: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/states/${entityId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    console.error(`[spotify] getEntity ${entityId} FAILED: ${res.status}`);
    throw new Error(`HA API ${res.status}`);
  }
  const data = await res.json() as { state: string; attributes: Record<string, unknown> };
  console.log(`[spotify] getEntity ${entityId} state=${data.state} source_list=${JSON.stringify(data.attributes.source_list ?? [])}`);
  return data;
}

async function getState(entityId: string): Promise<string> {
  return (await getEntity(entityId)).state;
}

// HA's Spotify integration is Connect-based - it can only send playback to an
// already-active device, it can't activate one on its own. If something is
// already actively playing (phone/desktop/TV), leave it alone - play_media will
// just switch what's playing there. Only wake the living room TV and open
// Spotify on it when nothing is actively playing anywhere.
async function ensureActiveDevice(): Promise<void> {
  const spotifyState = await getState(SPOTIFY_ENTITY);
  if (spotifyState === "playing") {
    console.log("[spotify] ensureActiveDevice: already playing, skipping TV wake");
    return;
  }

  const tvState = await getState(TV_REMOTE_ENTITY);
  if (tvState !== "on") {
    console.log("[spotify] ensureActiveDevice: TV not on, turning on and waiting 5s");
    await haService("remote.turn_on", { entity_id: TV_REMOTE_ENTITY });
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log("[spotify] ensureActiveDevice: opening Spotify on TV");
  await haService("remote.turn_on", { entity_id: TV_REMOTE_ENTITY, activity: "spotify://" });

  // The app being open isn't enough - Spotify needs to register the TV as a
  // known Connect device before it can be selected as the playback target.
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));
    const { attributes } = await getEntity(SPOTIFY_ENTITY);
    const sourceList = (attributes.source_list as string[] | undefined) ?? [];
    if (sourceList.includes(SPOTIFY_TV_SOURCE)) {
      console.log(`[spotify] ensureActiveDevice: "${SPOTIFY_TV_SOURCE}" available, selecting it`);
      await haService("media_player.select_source", { entity_id: SPOTIFY_ENTITY, source: SPOTIFY_TV_SOURCE });
      return;
    }
  }
  console.warn(`[spotify] ensureActiveDevice: "${SPOTIFY_TV_SOURCE}" never appeared in source_list, proceeding anyway`);
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
  console.log(`[spotify] haService ${service}`, JSON.stringify(data));
  const res = await fetch(`${baseUrl}/api/services/${domain}/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[spotify] haService ${service} FAILED: ${res.status} ${body}`);
    throw new Error(`HA ${res.status}: ${body}`);
  }
  console.log(`[spotify] haService ${service} OK`);
}

async function spotifySearchMultiple(query: string, type: "track" | "artist" | "playlist" | "album", limit: number, offset: number): Promise<{ uri: string; name: string; artist?: string; id?: string }[]> {
  const token = await getAccessToken();
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}&offset=${offset}&market=FI`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Spotify search failed: ${res.status}`);
  const data = await res.json() as any;

  const key = type === "playlist" ? "playlists" : type === "artist" ? "artists" : type === "album" ? "albums" : "tracks";
  const items = data[key]?.items ?? [];
  return items.map((item: any) => ({
    uri: item.uri,
    name: item.name,
    artist: item.artists?.[0]?.name,
    id: item.id,
  }));
}

// Relying on the model to correctly re-send the same query/type/offset when
// picking an option proved unreliable in practice - indirect pick phrasing
// ("take the first option" instead of "play the second one") made it lose
// track of the original search entirely and call no tool at all. Storing the
// last suggestion per-conversation means picking only needs an index, which
// is a much simpler thing for the model to get right.
const lastSuggestion = new Map<string, { query: string; type: "track" | "artist" | "playlist" | "album"; offset: number }>();

// Presents 3 numbered results without playing anything.
export async function spotifySuggest(conversationId: string, query: string, type: "track" | "artist" | "playlist" | "album" = "track", offset: number = 0): Promise<string> {
  if (!query.trim()) return "No search term given - what would you like me to look for?";
  const results = await spotifySearchMultiple(query, type, 3, offset);
  if (results.length === 0) {
    return offset === 0 ? `Couldn't find any ${type}s for "${query}".` : `No more ${type}s for "${query}".`;
  }
  lastSuggestion.set(conversationId, { query, type, offset });
  const list = results.map((r, i) => `${i + 1}. ${r.name}${r.artist ? ` by ${r.artist}` : ""}`).join(", ");
  return `Found: ${list}.`;
}

// Plays whichever numbered item (1-3) was picked from this conversation's most
// recent suggestion - the model only needs to supply the index, not recall the
// original query/type/offset itself.
export async function spotifyPlayIndexed(conversationId: string, index: number): Promise<string> {
  const last = lastSuggestion.get(conversationId);
  if (!last) return "I don't have a recent set of suggestions to pick from - ask me to search for something first.";
  return spotifyPlayFromSuggestions(last.query, last.type, last.offset, index);
}

export function clearSpotifySuggestion(conversationId: string): void {
  lastSuggestion.delete(conversationId);
}

async function spotifyPlayFromSuggestions(query: string, type: "track" | "artist" | "playlist" | "album", offset: number, index: number): Promise<string> {
  const results = await spotifySearchMultiple(query, type, 3, offset);
  const choice = results[index - 1];
  if (!choice) return `Couldn't find option ${index} for "${query}".`;

  // media_content_type "artist" isn't supported by HA's Spotify integration -
  // resolve to one of the artist's albums instead, same as before.
  if (type === "artist") {
    if (!choice.id) return `Couldn't resolve "${choice.name}" to play.`;
    const album = await spotifyArtistAlbum(choice.id);
    if (!album) return `Found ${choice.name} but couldn't find an album to play.`;
    await spotifyPlay(album.uri, "album");
    return `Playing ${album.name} by ${choice.name}.`;
  }

  await spotifyPlay(choice.uri, type);
  const label = choice.artist ? `${choice.name} by ${choice.artist}` : choice.name;
  return `Playing ${label}.`;
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
  console.log(`[spotify] spotifyPlay uri=${uri ?? "(none)"} type=${type ?? "(none)"}`);
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

// STT makes exact-name matches unreliable, so there's no direct "search and
// blind-play the top result" path anymore - only a known personal playlist
// (instant, unambiguous) or the search -> suggest -> pick-by-index flow.
// Returns null if query doesn't match a known personal playlist.
export async function spotifyPlayPersonal(query: string): Promise<string | null> {
  const uri = findPersonalPlaylist(query);
  if (!uri) return null;
  await spotifyPlay(uri, "playlist");
  return `Playing ${query}.`;
}
