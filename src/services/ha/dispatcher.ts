import type { Intent } from "../../types/intent.js";
import { getLights, getScenes, getAreas, resolveArea } from "./registry.js";
import { designScene, applyScene, saveCurrentStateAsScene } from "./scenes.js";

const baseUrl = process.env.HA_BASE_URL ?? "http://localhost:8123";
const token = process.env.HA_TOKEN ?? "";

async function callService(domain: string, service: string, data: Record<string, unknown> = {}): Promise<void> {
  const res = await fetch(`${baseUrl}/api/services/${domain}/${service}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HA API ${res.status}: ${body}`);
  }
}

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
      return `No area named "${intent.area}" exists. Known areas: ${known}.`;
    }
    target["area_id"] = area.area_id;
  }
  else if (intent.device) target["entity_id"] = intent.device;
  else target["entity_id"] = getLights().map(l => l.entity_id);

  const reply = (fallback: string) => intent.response ?? fallback;

  switch (intent.action) {
    case "light_on":
      await callService("light", "turn_on", target);
      return reply(intent.area ? `Lights on in ${intent.area}.` : "Lights on.");

    case "light_off":
      await callService("light", "turn_off", target);
      return reply(intent.area ? `Lights off in ${intent.area}.` : "Lights off.");

    case "light_dim":
      await callService("light", "turn_on", { ...target, brightness: intent.brightness ?? 128 });
      return reply("Brightness set.");

    case "light_color":
      await callService("light", "turn_on", { ...target, color_name: intent.color });
      return reply(`Color set to ${intent.color}.`);

    case "scene_activate": {
      const scenes = getScenes();
      const match = scenes.find(s =>
        s.scene_id === intent.scene ||
        s.name.toLowerCase() === intent.scene?.toLowerCase() ||
        s.entity_id === intent.scene
      );
      if (!match) {
        return `No scene named "${intent.scene}" exists. If this is a routine (HA script), use run_routine instead of scene_activate.`;
      }
      await callService("scene", "turn_on", { entity_id: match.entity_id });
      if (match.scene_id === "tv_time" || intent.scene === "tv_time") {
        await callService("remote", "turn_on", { entity_id: "remote.living_room_tv" });
        await callService("switch", "turn_on", { entity_id: "switch.rgbic_tv_backlight_dreamview" });
      }
      return reply(`Scene activated.`);
    }

    case "scene_create": {
      const name = intent.scene_name ?? "custom_scene";
      const entityIds = getLights().map(l => l.entity_id);
      await saveCurrentStateAsScene(name, entityIds);
      return reply(`Scene "${name}" saved.`);
    }

    case "scene_design": {
      const description = intent.scene_description ?? intent.raw;
      const plan = await designScene(description);
      await applyScene(plan);
      return reply(`Scene "${plan.name}" applied.`);
    }

    case "media_play":
      await callService("media_player", "media_play", target);
      return reply("Playing.");

    case "media_pause":
      await callService("media_player", "media_pause", target);
      return reply("Paused.");

    case "media_stop":
      await callService("media_player", "media_stop", target);
      return reply("Stopped.");

    case "media_volume":
      await callService("media_player", "volume_set", { ...target, volume_level: (intent.volume ?? 50) / 100 });
      return reply(`Volume set to ${intent.volume}%.`);

    case "switch_on":
      await callService("homeassistant", "turn_on", { entity_id: intent.device });
      return reply("Turned on.");

    case "switch_off":
      await callService("homeassistant", "turn_off", { entity_id: intent.device });
      return reply("Turned off.");

    case "unknown":
    default:
      return reply("I didn't understand that.");
  }
}
