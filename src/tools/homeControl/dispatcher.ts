import type { Intent } from "./intent.js";
import { getLights, getScenes, getAreas, resolveArea } from "../../integrations/homeAssistant/registry.js";
import { designScene, applyScene, saveCurrentStateAsScene } from "../../features/scenes/scenes.js";
import { callService as haCallService } from "../../integrations/homeAssistant/client.js";

// Thin wrapper so the switch below reads unchanged.
async function callService(domain: string, service: string, data: Record<string, unknown> = {}): Promise<void> {
  await haCallService(domain, service, data);
}

// An action that didn't happen throws, so it's reported as a failure: to the
// model, and for a scheduled run, out loud.
export async function dispatch(intent: Intent): Promise<string> {
  const target: Record<string, unknown> = {};
  if (intent.area) {
    // Verified against the real registry rather than slugified and hoped for.
    // An unknown area_id is not an error to HA - it answers 200 having done
    // nothing - so an unmatched area has to be caught here or it surfaces as a
    // confident confirmation of something that never happened.
    const area = resolveArea(intent.area);
    if (!area) {
      const known = getAreas().map(a => a.name).join(", ") || "none loaded";
      throw new Error(`No area named "${intent.area}" exists. Known areas: ${known}.`);
    }
    target["area_id"] = area.area_id;
  }
  else if (intent.device) target["entity_id"] = intent.device;
  else target["entity_id"] = getLights().map(l => l.entity_id);

  switch (intent.action) {
    case "light_on":
      await callService("light", "turn_on", target);
      return intent.area ? `Lights on in ${intent.area}.` : "Lights on.";

    case "light_off":
      await callService("light", "turn_off", target);
      return intent.area ? `Lights off in ${intent.area}.` : "Lights off.";

    case "light_dim": {
      // Percent, not 0-255. The tool used to take HA's raw `brightness` scale,
      // so a model asked to "dim to 50%" sent 50 and got 20% brightness - the
      // one number a person is most likely to say was also the most wrong.
      const pct = Math.max(0, Math.min(100, Math.round(intent.brightness_pct ?? 50)));
      await callService("light", "turn_on", { ...target, brightness_pct: pct });
      return `Brightness set to ${pct}%.`;
    }

    case "light_color":
      await callService("light", "turn_on", { ...target, color_name: intent.color });
      return `Color set to ${intent.color}.`;

    case "scene_activate": {
      const scenes = getScenes();
      const match = scenes.find(s =>
        s.scene_id === intent.scene ||
        s.name.toLowerCase() === intent.scene?.toLowerCase() ||
        s.entity_id === intent.scene
      );
      if (!match) {
        throw new Error(`No scene named "${intent.scene}" exists. If this is a routine (HA script), use run_routine instead of scene_activate.`);
      }
      await callService("scene", "turn_on", { entity_id: match.entity_id });
      if (match.scene_id === "tv_time" || intent.scene === "tv_time") {
        await callService("remote", "turn_on", { entity_id: "remote.living_room_tv" });
        await callService("switch", "turn_on", { entity_id: "switch.rgbic_tv_backlight_dreamview" });
      }
      return `Scene activated.`;
    }

    case "scene_create": {
      const name = intent.scene_name ?? "custom_scene";
      const entityIds = getLights().map(l => l.entity_id);
      await saveCurrentStateAsScene(name, entityIds);
      return `Scene "${name}" saved.`;
    }

    case "scene_design": {
      const description = intent.scene_description ?? intent.raw;
      const plan = await designScene(description);
      const result = await applyScene(plan);

      if (result.allSucceeded) return `Scene "${plan.name}" applied.`;
      if (result.anySucceeded) return `Scene "${plan.name}" only partially applied - some lights didn't respond.`;
      throw new Error(`Couldn't apply the "${plan.name}" scene - none of the lights responded.`);
    }

    case "media_play":
      await callService("media_player", "media_play", target);
      return "Playing.";

    case "media_pause":
      await callService("media_player", "media_pause", target);
      return "Paused.";

    case "media_stop":
      await callService("media_player", "media_stop", target);
      return "Stopped.";

    case "media_volume":
      await callService("media_player", "volume_set", { ...target, volume_level: (intent.volume ?? 50) / 100 });
      return `Volume set to ${intent.volume}%.`;

    case "switch_on":
    case "switch_off": {
      // These were the only actions using intent.device directly instead of
      // the computed target, so an area-scoped switch command sent
      // `entity_id: undefined` and quietly did nothing. Falling back to
      // target's default (every light in the house) would be worse than
      // doing nothing, so an unspecified switch is an error instead.
      if (!intent.device && !intent.area) {
        throw new Error("I need to know which switch - name the device or the area.");
      }
      const on = intent.action === "switch_on";
      await callService("homeassistant", on ? "turn_on" : "turn_off", target);
      return on ? "Turned on." : "Turned off.";
    }

    default:
      throw new Error("I didn't understand that.");
  }
}
