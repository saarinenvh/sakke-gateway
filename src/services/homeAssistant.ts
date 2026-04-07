import type { Intent } from "../types/intent.js";
import { getLights, getAllSwitches, getScenes } from "./entityRegistry.js";
import { designScene, applyScene, saveCurrentStateAsScene } from "./sceneDesigner.js";

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
  if (intent.area) target["area_id"] = intent.area.toLowerCase().replace(/\s+/g, "_");
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
      const sceneEntityId = match ? match.entity_id : `scene.${intent.scene}`;
      await callService("scene", "turn_on", { entity_id: sceneEntityId });
      if (match?.scene_id === "tv_time" || intent.scene === "tv_time") {
        await callService("media_player", "turn_on", { entity_id: "media_player.tv" });
      }
      return reply(`Scene activated.`);
    }

    case "scene_create": {
      const name = intent.scene_name ?? "custom_scene";
      const entityIds = [
        ...getLights().map(l => l.entity_id),
        ...getAllSwitches().map(s => s.entity_id),
      ];
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
      await callService("switch", "turn_on", { entity_id: intent.device });
      return reply("Switch turned on.");

    case "switch_off":
      await callService("switch", "turn_off", { entity_id: intent.device });
      return reply("Switch turned off.");

    case "bedtime_routine":
      await callService("light", "turn_off", { entity_id: getLights().map(l => l.entity_id) });
      await callService("media_player", "turn_off", { entity_id: "media_player.tv" });
      await callService("media_player", "turn_on", { entity_id: "media_player.chromecast" });
      return reply("Lights off, TV off, bedroom Chromecast on. Don't forget to brush your teeth. I won't remind you again. Tonight.");

    case "morning_routine":
      await callService("scene", "turn_on", { entity_id: "scene.default" });
      await callService("light", "turn_on", { area_id: "bedroom" });
      return reply("Rise and shine. Lights are on and the default scene is active. The coffee maker won't turn itself on, just so you know.");

    case "unknown":
    default:
      return reply("I didn't understand that.");
  }
}
