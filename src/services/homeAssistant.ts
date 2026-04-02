import type { Intent } from "../types/intent.js";

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
  if (intent.area) target["area_id"] = intent.area;
  if (intent.device) target["entity_id"] = intent.device;

  switch (intent.action) {
    case "light_on":
      await callService("light", "turn_on", target);
      return intent.area ? `Lights on in ${intent.area}.` : "Lights on.";

    case "light_off":
      await callService("light", "turn_off", target);
      return intent.area ? `Lights off in ${intent.area}.` : "Lights off.";

    case "light_dim":
      await callService("light", "turn_on", { ...target, brightness: intent.brightness ?? 128 });
      return `Brightness set.`;

    case "light_color":
      await callService("light", "turn_on", { ...target, color_name: intent.color });
      return `Color set to ${intent.color}.`;

    case "scene_activate":
      await callService("scene", "turn_on", { entity_id: `scene.${intent.scene}` });
      return `Scene "${intent.scene}" activated.`;

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

    case "unknown":
    default:
      return `I didn't understand: "${intent.raw}"`;
  }
}
