export type LightAction = "light_on" | "light_off" | "light_dim" | "light_color";
export type MediaAction = "media_play" | "media_pause" | "media_stop" | "media_volume";
export type SceneAction = "scene_activate";
export type UnknownAction = "unknown";

export type IntentAction = LightAction | MediaAction | SceneAction | UnknownAction;

export interface Intent {
  action: IntentAction;
  area?: string;       // e.g. "living_room", "bedroom"
  device?: string;     // specific device name if mentioned
  scene?: string;      // for scene_activate
  brightness?: number; // 0–255 for light_dim
  color?: string;      // color name for light_color
  volume?: number;     // 0–100 for media_volume
  raw: string;         // original command text
}
