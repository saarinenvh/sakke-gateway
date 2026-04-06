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

  const reply = (fallback: string) => intent.response ?? fallback;

  switch (intent.action) {
    case "light_on":
      await callService("light", "turn_on", target);
      return reply(intent.area ? `${intent.area} valot sytytetty.` : "Valot sytytetty.");

    case "light_off":
      await callService("light", "turn_off", target);
      return reply(intent.area ? `${intent.area} valot sammutettu.` : "Valot sammutettu.");

    case "light_dim":
      await callService("light", "turn_on", { ...target, brightness: intent.brightness ?? 128 });
      return reply("Kirkkaus asetettu.");

    case "light_color":
      await callService("light", "turn_on", { ...target, color_name: intent.color });
      return reply(`Väri vaihdettu.`);

    case "scene_activate":
      await callService("scene", "turn_on", { entity_id: `scene.${intent.scene}` });
      return reply(`Skene aktivoitu.`);

    case "media_play":
      await callService("media_player", "media_play", target);
      return reply("Toistetaan.");

    case "media_pause":
      await callService("media_player", "media_pause", target);
      return reply("Tauolla.");

    case "media_stop":
      await callService("media_player", "media_stop", target);
      return reply("Pysäytetty.");

    case "media_volume":
      await callService("media_player", "volume_set", { ...target, volume_level: (intent.volume ?? 50) / 100 });
      return reply(`Äänenvoimakkuus asetettu ${intent.volume} prosenttiin.`);

    case "switch_on":
      await callService("switch", "turn_on", { entity_id: intent.device });
      return reply("Kytkin päällä.");

    case "switch_off":
      await callService("switch", "turn_off", { entity_id: intent.device });
      return reply("Kytkin pois.");

    case "unknown":
    default:
      return reply("En ymmärtänyt komentoa.");
  }
}
