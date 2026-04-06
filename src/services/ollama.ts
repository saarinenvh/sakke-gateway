import type { Intent } from "../types/intent.js";
import { getLights, getAreas, getSwitches } from "./entityRegistry.js";

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const model = process.env.OLLAMA_MODEL ?? "llama3";

function buildSystemPrompt(): string {
  const lights = getLights();
  const areas = getAreas();
  const switches = getSwitches();

  const lightList = lights
    .map(l => `  - "${l.name}" (entity_id: ${l.entity_id}${l.area ? `, area: ${l.area}` : ""})`)
    .join("\n");

  const areaList = areas
    .map(a => `  - "${a.name}" (area_id: ${a.area_id})`)
    .join("\n");

  const switchList = switches
    .map(s => `  - "${s.name}" (entity_id: ${s.entity_id})`)
    .join("\n");

  return `You are a smart home intent parser.
Given a natural language command, respond with ONLY a valid JSON object describing the intent.

Possible actions:
- light_on / light_off — turn lights on or off
- light_dim — adjust brightness (brightness: 0-255)
- light_color — change light color (color: string)
- scene_activate — activate a named scene (scene: string)
- switch_on / switch_off — toggle a switch (device: entity_id)
- media_play / media_pause / media_stop — media control
- media_volume — set volume (volume: 0-100)
- unknown — if the command is not a smart home command

Use "area" (area_id) for room-level commands, "device" (entity_id) for specific lights or switches.
Prefer area over device when the command targets a whole room.

Available areas:
${areaList}

Available lights:
${lightList}

Available switches:
${switchList}

Always include a short "response" field — a friendly 1-sentence confirmation in the same language as the user's command.

Examples:
User: "turn off the lights"
{"action":"light_off","response":"Lights off.","raw":"turn off the lights"}

User: "turn on living room lights"
{"action":"light_on","area":"living_room","response":"Living room lights on.","raw":"turn on living room lights"}

User: "dim the desk lamp to 30%"
{"action":"light_dim","device":"light.led_strip_light_m1","brightness":77,"response":"Desk lamp dimmed to 30%.","raw":"dim the desk lamp to 30%"}

User: "set tv backlight to blue"
{"action":"light_color","device":"light.rgbic_tv_backlight","color":"blue","response":"TV backlight set to blue.","raw":"set tv backlight to blue"}

User: "turn on dreamview"
{"action":"switch_on","device":"switch.rgbic_tv_backlight_dreamview","response":"Dreamview is on.","raw":"turn on dreamview"}

User: "laita olohuoneen valot pois"
{"action":"light_off","area":"living_room","response":"Olohuoneen valot sammutettu.","raw":"laita olohuoneen valot pois"}

Respond with JSON only. No explanation, no markdown.`;
}

export async function parseIntent(text: string): Promise<Intent> {
  const body = {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: text },
    ],
    stream: false,
    options: { temperature: 0.1, num_predict: 200 },
  };

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json() as { message?: { content?: string } };
  const content = json?.message?.content?.trim() ?? "";

  try {
    const parsed = JSON.parse(content) as Partial<Intent>;
    return { ...parsed, raw: text, action: parsed.action ?? "unknown" } as Intent;
  } catch {
    return { action: "unknown", raw: text };
  }
}
