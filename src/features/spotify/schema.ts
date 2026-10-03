import { z } from "zod";

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
  source_list: z.array(z.string()).nullish(),
});
