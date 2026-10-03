import { moduleLog } from "../../logger.js";
import { getState as haGetState, callService } from "../../integrations/homeAssistant/client.js";
import { findArtistAlbum, searchSpotify, type SpotifyContentType, type SpotifySearchItem } from "../../integrations/spotify/client.js";
import { parseOrThrow } from "../../util/validation.js";
import { spotifyPlayerAttributesSchema } from "./schema.js";

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
export function findPersonalPlaylist(query: string): string | null {
  const normalized = query.trim().toLowerCase().replace(FILLER_WORDS, "").replace(/\s+/g, " ").trim();
  if (PERSONAL_PLAYLISTS[normalized]) return PERSONAL_PLAYLISTS[normalized];
  for (const [name, uri] of Object.entries(PERSONAL_PLAYLISTS)) {
    const threshold = name.length <= 6 ? 1 : 2;
    if (levenshtein(normalized, name) <= threshold) return uri;
  }
  return null;
}

async function getEntity(entityId: string): Promise<{ state: string; attributes: Record<string, unknown> }> {
  const data = await haGetState(entityId, { timeoutMs: 5000 });
  moduleLog().info({ tool: "spotify" }, `getEntity ${entityId} state=${data.state} source_list=${JSON.stringify(data.attributes.source_list ?? [])}`);
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
    moduleLog().info({ tool: "spotify" }, "ensureActiveDevice: already playing, skipping TV wake");
    return;
  }

  const tvState = await getState(TV_REMOTE_ENTITY);
  if (tvState !== "on") {
    moduleLog().info({ tool: "spotify" }, "ensureActiveDevice: TV not on, turning on and waiting 5s");
    await haService("remote.turn_on", { entity_id: TV_REMOTE_ENTITY });
    await new Promise(r => setTimeout(r, 5000));
  }

  moduleLog().info({ tool: "spotify" }, "ensureActiveDevice: opening Spotify on TV");
  await haService("remote.turn_on", { entity_id: TV_REMOTE_ENTITY, activity: "spotify://" });

  // The app being open isn't enough - Spotify needs to register the TV as a
  // known Connect device before it can be selected as the playback target.
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));
    const { attributes } = await getEntity(SPOTIFY_ENTITY);
    const sourceList = parseOrThrow(spotifyPlayerAttributesSchema, attributes, `HA ${SPOTIFY_ENTITY} attributes`).source_list ?? [];
    if (sourceList.includes(SPOTIFY_TV_SOURCE)) {
      moduleLog().info({ tool: "spotify" }, `ensureActiveDevice: "${SPOTIFY_TV_SOURCE}" available, selecting it`);
      await haService("media_player.select_source", { entity_id: SPOTIFY_ENTITY, source: SPOTIFY_TV_SOURCE });
      return;
    }
  }
  moduleLog().warn({ tool: "spotify" }, `ensureActiveDevice: "${SPOTIFY_TV_SOURCE}" never appeared in source_list, proceeding anyway`);
}

async function haService(service: string, data: Record<string, unknown>): Promise<void> {
  const [domain, action] = service.split(".");
  moduleLog().info({ tool: "spotify", service, data }, "Spotify HA service call");
  try {
    await callService(domain, action, data, { timeoutMs: 8000 });
  } catch (err: any) {
    moduleLog().error({ tool: "spotify", err: err.message }, `haService ${service} failed`);
    throw err;
  }
  moduleLog().info({ tool: "spotify" }, `haService ${service} OK`);
}

// Each conversation's last suggestion, so a pick needs only an index. The model
// loses track of a query it has to re-send, and a re-run search may come back
// reordered, so the resolved items are kept rather than the search.
const lastSuggestion = new Map<string, { items: SpotifySearchItem[]; type: SpotifyContentType; query: string }>();

// Presents 3 numbered results without playing anything.
export async function spotifySuggest(conversationId: string, query: string, type: SpotifyContentType = "track", offset: number = 0): Promise<string> {
  if (!query.trim()) return "No search term given - what would you like me to look for?";
  const results = await searchSpotify(query, type, 3, offset);
  if (results.length === 0) {
    return offset === 0 ? `Couldn't find any ${type}s for "${query}".` : `No more ${type}s for "${query}".`;
  }
  lastSuggestion.set(conversationId, { items: results, type, query });
  const list = results.map((r, i) => `${i + 1}. ${r.name}${r.artist ? ` by ${r.artist}` : ""}`).join(", ");
  return `Found: ${list}.`;
}

// Plays whichever numbered item (1-3) was picked from this conversation's most
// recent suggestion - the model only needs to supply the index, not recall the
// original query/type/offset itself.
export async function spotifyPlayIndexed(conversationId: string, index: number): Promise<string> {
  const last = lastSuggestion.get(conversationId);
  if (!last) return "I don't have a recent set of suggestions to pick from - ask me to search for something first.";
  const choice = last.items[index - 1];
  if (!choice) return `I only offered ${last.items.length} option${last.items.length === 1 ? "" : "s"} for "${last.query}".`;
  return playResolved(choice, last.type);
}

export function clearSpotifySuggestion(conversationId: string): void {
  lastSuggestion.delete(conversationId);
}

async function playResolved(choice: SpotifySearchItem, type: SpotifyContentType): Promise<string> {
  // media_content_type "artist" isn't supported by HA's Spotify integration -
  // resolve to one of the artist's albums instead.
  if (type === "artist") {
    const album = await findArtistAlbum(choice.id);
    if (!album) return `Found ${choice.name} but couldn't find an album to play.`;
    await spotifyPlay(album.uri, "album");
    return `Playing ${album.name} by ${choice.name}.`;
  }

  await spotifyPlay(choice.uri, type);
  const label = choice.artist ? `${choice.name} by ${choice.artist}` : choice.name;
  return `Playing ${label}.`;
}

export async function spotifyPlay(uri?: string, type?: SpotifyContentType): Promise<string> {
  moduleLog().info({ tool: "spotify" }, `spotifyPlay uri=${uri ?? "(none)"} type=${type ?? "(none)"}`);
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
