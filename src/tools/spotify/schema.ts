import { z } from "zod";
import { modelNumber } from "../parameters.js";

// Model → gateway: the arguments of a spotify tool call.

export const spotifyArgsExample = {
  action: "suggest",
  query: "in flames",
  type: "artist",
  offset: 3,
};

const SPOTIFY_ACTIONS = ["play", "pause", "next", "previous", "volume", "suggest"] as const;
const SPOTIFY_CONTENT_TYPES = ["track", "artist", "playlist", "album"] as const;

// The model borrows these from HA's media player when it means pause.
const PAUSE_ALIASES: readonly unknown[] = ["stop", "media_stop"];

export const spotifyArgsSchema = z.object({
  action: z.preprocess(action => (PAUSE_ALIASES.includes(action) ? "pause" : action), z.enum(SPOTIFY_ACTIONS)),
  query: z.string().optional()
    .describe("Search query for suggest, or for play when directly naming a known personal playlist. Omit when picking a previously suggested option by index."),
  type: z.enum(SPOTIFY_CONTENT_TYPES).optional()
    .describe("Type of content to search for (defaults to track). Only used with suggest."),
  volume: modelNumber.optional().describe("0-100 for volume action"),
  offset: modelNumber.optional().describe("Pagination offset for suggest only - 0 for first 3 results, 3 for the next 3, etc."),
  index: modelNumber.optional()
    .describe("For 'play' only: which of the 3 most recently suggested options to play (1, 2, or 3). No other parameters needed - the server already knows what was suggested."),
});

// HA → gateway, GET /api/states/<Spotify media player>: the attributes of
// the Spotify integration's player.

export const spotifyPlayerAttributesExample = {
  volume_level: 0.4, // ignored
  is_volume_muted: false, // ignored
  media_content_id: "spotify:track:0000000000000000000001", // ignored
  media_content_type: "music", // ignored
  media_duration: 215, // ignored
  media_position: 42, // ignored
  media_position_updated_at: "2026-10-03T07:42:00.000000+00:00", // ignored
  media_title: "Example Song", // ignored
  media_artist: "Example Band", // ignored
  media_album_name: "Example Album", // ignored
  media_track: 3, // ignored
  entity_picture: "/api/media_player_proxy/media_player.spotify_example?token=abc&cache=def", // ignored
  shuffle: false, // ignored
  repeat: "off", // ignored
  source: "Phone", // ignored
  source_list: ["Phone", "Desktop", "Tv"],
  friendly_name: "Spotify Example", // ignored
  supported_features: 444983, // ignored
};

export const spotifyPlayerAttributesSchema = z.object({
  source_list: z.array(z.string()).optional(),
});

// Spotify Web API → gateway (client credentials flow).

// POST https://accounts.spotify.com/api/token
export const tokenResponseExample = {
  access_token: "example-access-token",
  token_type: "Bearer", // ignored
  expires_in: 3600,
};

export const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

const exampleArtist = {
  external_urls: { spotify: "https://open.spotify.com/artist/0000000000000000000001" }, // ignored
  href: "https://api.spotify.com/v1/artists/0000000000000000000001", // ignored
  id: "0000000000000000000001", // ignored
  name: "Example Band",
  type: "artist", // ignored
  uri: "spotify:artist:0000000000000000000001", // ignored
};

const exampleAlbum = {
  album_type: "album", // ignored
  total_tracks: 10, // ignored
  external_urls: { spotify: "https://open.spotify.com/album/0000000000000000000002" }, // ignored
  href: "https://api.spotify.com/v1/albums/0000000000000000000002", // ignored
  id: "0000000000000000000002",
  images: [{ url: "https://i.scdn.co/image/example", height: 640, width: 640 }], // ignored
  is_playable: true, // ignored
  name: "Example Album",
  release_date: "2024-05-17", // ignored
  release_date_precision: "day", // ignored
  type: "album", // ignored
  uri: "spotify:album:0000000000000000000002",
  artists: [exampleArtist], // only the first artist's name is read
};

const examplePage = {
  href: "https://api.spotify.com/v1/search?offset=0&limit=3&query=example&type=track&market=FI", // ignored
  limit: 3, // ignored
  next: "https://api.spotify.com/v1/search?offset=3&limit=3&query=example&type=track&market=FI", // ignored
  offset: 0, // ignored
  previous: null, // ignored
  total: 120, // ignored
};

// GET https://api.spotify.com/v1/search?type=track, one page per requested
// type: tracks, artists, albums, or playlists.
export const trackSearchResponseExample = {
  tracks: {
    ...examplePage,
    items: [
      {
        album: exampleAlbum, // ignored
        artists: [exampleArtist],
        disc_number: 1, // ignored
        duration_ms: 215000, // ignored
        explicit: false, // ignored
        external_ids: { isrc: "XX0000000001" }, // ignored
        external_urls: { spotify: "https://open.spotify.com/track/0000000000000000000003" }, // ignored
        href: "https://api.spotify.com/v1/tracks/0000000000000000000003", // ignored
        id: "0000000000000000000003",
        is_local: false, // ignored
        is_playable: true, // ignored
        name: "Example Song",
        popularity: 52, // ignored
        preview_url: null, // ignored
        track_number: 3, // ignored
        type: "track", // ignored
        uri: "spotify:track:0000000000000000000003",
      },
    ],
  },
};

export const artistSearchResponseExample = {
  artists: {
    ...examplePage,
    items: [
      {
        external_urls: { spotify: "https://open.spotify.com/artist/0000000000000000000001" }, // ignored
        followers: { href: null, total: 12000 }, // ignored
        genres: ["melodic death metal"], // ignored
        images: [{ url: "https://i.scdn.co/image/example", height: 640, width: 640 }], // ignored
        href: "https://api.spotify.com/v1/artists/0000000000000000000001", // ignored
        id: "0000000000000000000001",
        name: "Example Band",
        popularity: 60, // ignored
        type: "artist", // ignored
        uri: "spotify:artist:0000000000000000000001",
      },
    ],
  },
};

export const albumSearchResponseExample = {
  albums: { ...examplePage, items: [exampleAlbum] },
};

export const playlistSearchResponseExample = {
  playlists: {
    ...examplePage,
    items: [
      {
        collaborative: false, // ignored
        description: "Example playlist.", // ignored
        external_urls: { spotify: "https://open.spotify.com/playlist/0000000000000000000004" }, // ignored
        href: "https://api.spotify.com/v1/playlists/0000000000000000000004", // ignored
        id: "0000000000000000000004",
        images: [{ url: "https://i.scdn.co/image/example", height: null, width: null }], // ignored
        name: "Example Playlist",
        owner: { display_name: "Example User", id: "example-user", type: "user" }, // ignored
        public: true, // ignored
        snapshot_id: "example-snapshot", // ignored
        tracks: { href: "https://api.spotify.com/v1/playlists/0000000000000000000004/tracks", total: 50 }, // ignored
        type: "playlist", // ignored
        uri: "spotify:playlist:0000000000000000000004",
      },
      null,
    ],
  },
};

const searchItemSchema = z.object({
  uri: z.string(),
  name: z.string(),
  id: z.string(),
  artists: z.array(z.object({ name: z.string() })).optional(),
});

// Playlist search sometimes mixes in null entries (deleted or made-private
// playlists that still match the query).
const searchPageSchema = z.object({ items: z.array(searchItemSchema.nullable()) });

export type SearchResultKey = "tracks" | "artists" | "playlists" | "albums";

// Spotify answers with one page per requested type; the page for the type
// asked about must be there - a missing one is malformed, not "no results".
export function searchResponseSchemaFor(key: SearchResultKey) {
  return z.object({ [key]: searchPageSchema });
}

// GET https://api.spotify.com/v1/artists/{id}/albums
export const artistAlbumsResponseExample = {
  ...examplePage,
  items: [
    {
      ...exampleAlbum, // only uri and name are read
      album_group: "album", // ignored
    },
  ],
};

export const artistAlbumsResponseSchema = z.object({
  items: z.array(z.object({ uri: z.string(), name: z.string() })),
});
