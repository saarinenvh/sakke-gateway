import { z } from "zod";
import { modelNumber } from "../parameters.js";
import { SPOTIFY_CONTENT_TYPES } from "../../integrations/spotify/schema.js";

// Model → gateway: the arguments of a spotify tool call.

export const spotifyArgsExample = {
  action: "suggest",
  query: "in flames",
  type: "artist",
  offset: 3,
};

const SPOTIFY_ACTIONS = ["play", "pause", "next", "previous", "volume", "suggest"] as const;

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
