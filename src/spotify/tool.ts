import type { Tool } from "../tools/types.js";
import { spotifyPlay, spotifyPause, spotifyNext, spotifyPrevious, spotifyVolume, spotifySuggest, spotifyPlayIndexed, spotifyPlayPersonal } from "./spotify.js";

export const spotifyTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "spotify",
      description: "Control Spotify playback, or find and play a track/artist/album/playlist by name. Voice input is unreliable for exact names, so there is no direct search-and-blind-play - always use action 'suggest' first for ANY named request (a song, artist, album, or playlist) to present 3 numbered options by voice, e.g. 'Found: 1. X, 2. Y, 3. Z'. When the user picks one (e.g. 'play the second one', 'take the first option', 'the last one'), use action 'play' with ONLY index (1, 2, or 3) - do not repeat the query/type, the server remembers the last suggestions in this conversation. To hear more options, call suggest again with the SAME query/type and offset increased by 3. Exception: if the query exactly matches a known personal playlist name, calling 'suggest' plays it directly instead of returning a list - in that case the tool result will read like 'Playing X.', NOT a numbered list. IMPORTANT: always base your reply on the ACTUAL tool result text you receive, never on what a typical 'suggest' call usually returns - if the result already confirms something is playing, just confirm that in your own words, do not invent a list or ask 'which one?'.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["play", "pause", "next", "previous", "volume", "suggest"],
          },
          query: { type: "string", description: "Search query for suggest, or for play when directly naming a known personal playlist. Omit when picking a previously suggested option by index." },
          type: {
            type: "string",
            enum: ["track", "artist", "playlist", "album"],
            description: "Type of content to search for (defaults to track). Only used with suggest.",
          },
          volume: { type: "number", description: "0-100 for volume action" },
          offset: { type: "number", description: "Pagination offset for suggest only - 0 for first 3 results, 3 for the next 3, etc." },
          index: { type: "number", description: "For 'play' only: which of the 3 most recently suggested options to play (1, 2, or 3). No other parameters needed - the server already knows what was suggested." },
        },
        required: ["action"],
      },
    },
  },
  execute: async (args, { conversationId }) => {
    const { action, query, type, volume, offset, index } = args as {
      action: string;
      query?: string;
      type?: "track" | "artist" | "playlist" | "album";
      volume?: number;
      offset?: number;
      index?: number;
    };

    if (action === "suggest" && query) {
      // A known personal playlist should play instantly regardless of which
      // action the model picked - the model is told to always call "suggest"
      // first for named requests, so the personal-playlist shortcut can't
      // depend on it choosing "play" instead.
      return (await spotifyPlayPersonal(query)) ?? await spotifySuggest(conversationId, query, type ?? "track", offset ?? 0);
    }
    if (action === "suggest") return spotifySuggest(conversationId, query ?? "", type ?? "track", offset ?? 0);
    if (index && action === "play") return spotifyPlayIndexed(conversationId, index);
    if (action === "play" && query) {
      // No direct search-and-blind-play anymore - STT makes exact-name matches
      // too unreliable. A known personal playlist plays instantly (unambiguous);
      // anything else falls back to search results instead of guessing.
      return (await spotifyPlayPersonal(query)) ?? await spotifySuggest(conversationId, query, type ?? "track", 0);
    }
    if (action === "play") return spotifyPlay();
    if (action === "pause" || action === "stop" || action === "media_stop") return spotifyPause();
    if (action === "next") return spotifyNext();
    if (action === "previous") return spotifyPrevious();
    if (action === "volume") return spotifyVolume(volume ?? 50);
    return `Unknown spotify action: ${action}. Valid actions: play, pause, next, previous, volume, suggest.`;
  },
};
