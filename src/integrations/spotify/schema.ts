import { z } from "zod";

// Spotify Web API → gateway (client credentials flow).

// The search types the gateway asks for.
export const SPOTIFY_CONTENT_TYPES = ["track", "artist", "playlist", "album"] as const;
export type SpotifyContentType = (typeof SPOTIFY_CONTENT_TYPES)[number];

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
