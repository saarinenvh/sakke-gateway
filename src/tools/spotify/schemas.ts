import { z } from "zod";

// The shapes read back from Spotify's Web API (client credentials flow). Only
// the fields spotify.ts uses are declared.

export const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

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

export const artistAlbumsResponseSchema = z.object({
  items: z.array(z.object({ uri: z.string(), name: z.string() })),
});
