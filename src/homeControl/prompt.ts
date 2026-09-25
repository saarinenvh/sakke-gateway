import { getAreas, getScenes, getScripts } from "../integrations/homeAssistant/registry.js";

export function homeControlPrompt(): string {
  const areas = getAreas().map(a => `  - ${a.name} (${a.area_id})`).join("\n");
  const scenes = getScenes().map(s => `  - ${s.name} (${s.scene_id})`).join("\n");
  const scripts = getScripts().map(s => `  - ${s.name} (${s.script_id})`).join("\n") || "  (none defined)";

  // The device list below is now the ONLY description of these devices - the
  // wiki's home/devices page was deleted, because it was a hand-maintained copy
  // of entities Home Assistant already knows, and it had drifted (it still
  // advertised a Spotify search_and_play capability removed from the code).
  // Inlining the handful of devices used constantly also means "turn off the
  // TV" costs no extra round trip. The eventual replacement for the hand-kept
  // part is a lookup_entity tool over the live registry - see REFACTOR_PLAN.md
  // section 5.
  return `Home control: use control_home_assistant. If a LIGHT name is unfamiliar, call get_context("home/lighting") to map it to an entity ID, then act on the original request — never summarise the context back at the user. Skip get_context if you already know the entity ID. If a scene, area or routine isn't listed below, or the user asks you to refresh what you know about the house, call refresh_home_data before claiming it doesn't exist.

Devices:
- "TV" with no room means the living room TV. Never ask which one.
- Living room TV power: device "remote.living_room_tv", action switch_on/switch_off. media_stop only pauses what's playing, it does not power off the TV.
- Living room TV media: device "media_player.living_room_tv" for media_play/media_pause/media_stop/media_volume.
- Bedroom TV power: device "remote.bedroom_tv". Bedroom TV media: device "media_player.bedroom_tv".
- Coffee maker: device "switch.coffee_maker".
- Dreamview (TV backlight sync): device "switch.rgbic_tv_backlight_dreamview", turn_on/turn_off.
- Opening an app on the TV: use open_tv_app. Supported: netflix, youtube, spotify, dgn (Disc Golf Network).
- Exiting an app: tv_remote_command with "home". Going back a screen: "back". Neither media_stop nor switch_off will exit an app.
- Searching inside a TV app: open the app, then tv_remote_command with "search" to focus the field, then tv_send_text with the query — two separate calls in sequence, never combined.

Available areas:
${areas}

Available scenes:
${scenes}

Available routines (HA scripts — run with run_routine):
${scripts}`;
}
