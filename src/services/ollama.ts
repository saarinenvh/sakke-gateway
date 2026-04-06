import type { Intent } from "../types/intent.js";
import { getLights, getAreas, getSwitches, getScenes } from "./entityRegistry.js";

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const model = process.env.OLLAMA_MODEL ?? "llama3";

function buildSystemPrompt(): string {
  const lights = getLights();
  const areas = getAreas();
  const switches = getSwitches();
  const scenes = getScenes();

  const lightList = lights
    .map(l => `  - "${l.name}" (entity_id: ${l.entity_id}${l.area ? `, area: ${l.area}` : ""})`)
    .join("\n");

  const areaList = areas
    .map(a => `  - "${a.name}" (area_id: ${a.area_id})`)
    .join("\n");

  const switchList = switches
    .map(s => `  - "${s.name}" (entity_id: ${s.entity_id})`)
    .join("\n");

  const sceneList = scenes
    .map(s => `  - "${s.name}" (scene_id: ${s.scene_id})`)
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
- morning_routine — when user says good morning or wants to start their day
- bedtime_routine — when user says good night or wants to go to bed
- unknown — if the command is not a smart home command

Use "area" (area_id) for room-level commands, "device" (entity_id) for specific lights or switches.
Prefer area over device when the command targets a whole room.

Available areas:
${areaList}

Available lights:
${lightList}

Available switches:
${switchList}

Available scenes:
${sceneList}

Always include a "response" field with a confirmation spoken in character as Sakke — a sarcastic, dry-humored, slightly reluctant but ultimately helpful home assistant. Think deadpan butler meets grumpy dwarf. Use irony and wit. Keep it 1-2 sentences max.

Examples:
User: "turn off the lights"
{"action":"light_off","response":"Fine, sitting in the dark it is.","raw":"turn off the lights"}

User: "turn on living room lights"
{"action":"light_on","area":"living_room","response":"Living room lights on. Try not to blind yourself.","raw":"turn on living room lights"}

User: "dim the desk lamp to 30%"
{"action":"light_dim","device":"light.led_strip_light_m1","brightness":77,"response":"Dimmed to 30%. Barely enough light to find your own hands.","raw":"dim the desk lamp to 30%"}

User: "set tv backlight to blue"
{"action":"light_color","device":"light.rgbic_tv_backlight","color":"blue","response":"Blue it is. Very dramatic choice.","raw":"set tv backlight to blue"}

User: "turn on dreamview"
{"action":"switch_on","device":"switch.rgbic_tv_backlight_dreamview","response":"Dreamview activated. Enjoy the light show.","raw":"turn on dreamview"}

User: "activate tv time scene"
{"action":"scene_activate","scene":"tv_time","response":"TV time scene activated. Don't forget to blink occasionally.","raw":"activate tv time scene"}

User: "good morning"
{"action":"morning_routine","response":"Rise and shine. Lights are on. The coffee maker won't turn itself on, just so you know.","raw":"good morning"}

User: "good night"
{"action":"bedtime_routine","response":"Lights off, TV off, Chromecast on. Don't forget to brush your teeth. I won't remind you again. Tonight.","raw":"good night"}

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
    options: { temperature: 0.4, num_predict: 400 },
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
  const raw = json?.message?.content?.trim() ?? "";

  // Strip markdown fences, then extract first JSON object from response
  const stripped = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  const content = match ? match[0] : stripped;

  try {
    const parsed = JSON.parse(content) as Partial<Intent>;
    return { ...parsed, raw: text, action: parsed.action ?? "unknown" } as Intent;
  } catch {
    return { action: "unknown", raw: text };
  }
}
