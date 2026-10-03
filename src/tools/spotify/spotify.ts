import type { ToolContext } from "../types.js";
import { parseToolArgs } from "../parameters.js";
import { spotifyPlay, spotifyPause, spotifyNext, spotifyPrevious, spotifyVolume, spotifySuggest, spotifyPlayIndexed, spotifyPlayPersonal } from "../../features/spotify/spotify.js";
import { spotifyArgsSchema } from "./schema.js";

export async function executeSpotify(args: Record<string, unknown>, { conversationId }: ToolContext): Promise<string> {
  const { action, query, type = "track", volume, offset = 0, index } = parseToolArgs(spotifyArgsSchema, args, "spotify");

  switch (action) {
    case "suggest":
      if (!query) return spotifySuggest(conversationId, "", type, offset);
      // A known personal playlist should play instantly regardless of which
      // action the model picked - the model is told to always call "suggest"
      // first for named requests, so the personal-playlist shortcut can't
      // depend on it choosing "play" instead.
      return (await spotifyPlayPersonal(query)) ?? await spotifySuggest(conversationId, query, type, offset);
    case "play":
      if (index) return spotifyPlayIndexed(conversationId, index);
      if (!query) return spotifyPlay();
      // STT makes exact names unreliable: only a known personal playlist plays
      // directly; anything else gets suggestions instead of a guess.
      return (await spotifyPlayPersonal(query)) ?? await spotifySuggest(conversationId, query, type, 0);
    case "pause":
      return spotifyPause();
    case "next":
      return spotifyNext();
    case "previous":
      return spotifyPrevious();
    case "volume":
      return spotifyVolume(volume ?? 50);
  }
}
