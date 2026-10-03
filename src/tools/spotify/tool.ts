import type { Tool } from "../types.js";
import { toolParameters } from "../parameters.js";
import { spotifyArgsSchema } from "./schema.js";
import { executeSpotify } from "./spotify.js";

export const spotifyTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "spotify",
      description: "Control Spotify playback, or find and play a track/artist/album/playlist by name. Voice input is unreliable for exact names, so there is no direct search-and-blind-play - always use action 'suggest' first for ANY named request (a song, artist, album, or playlist) to present 3 numbered options by voice, e.g. 'Found: 1. X, 2. Y, 3. Z'. When you speak that list, say the actual names from the tool result out loud, in order - e.g. 'Found In Flames, Trivium, or flames - which one?' NEVER say just 'the first one, the second one, the third one' with no names: there is no screen, a position number alone tells the user nothing. When the user picks one (e.g. 'play the second one', 'take the first option', 'the last one'), use action 'play' with ONLY index (1, 2, or 3) - do not repeat the query/type, the server remembers the last suggestions in this conversation. To hear more options, call suggest again with the SAME query/type and offset increased by 3. Exception: if the query exactly matches a known personal playlist name, calling 'suggest' plays it directly instead of returning a list - in that case the tool result will read like 'Playing X.', NOT a numbered list. IMPORTANT: always base your reply on the ACTUAL tool result text you receive, never on what a typical 'suggest' call usually returns - if the result already confirms something is playing, just confirm that in your own words, do not invent a list or ask 'which one?'.",
      parameters: toolParameters(spotifyArgsSchema),
    },
  },
  repeatable: () => false,
  execute: executeSpotify,
};
