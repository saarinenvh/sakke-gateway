import type { Intent } from "../types/intent.js";

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const model = process.env.OLLAMA_MODEL ?? "llama3";

const SYSTEM_PROMPT = `You are a smart home intent parser.
Given a natural language command, respond with ONLY a valid JSON object describing the intent.

Possible actions:
- light_on / light_off — turn lights on or off
- light_dim — adjust brightness (brightness: 0-255)
- light_color — change light color (color: string)
- scene_activate — activate a named scene (scene: string)
- media_play / media_pause / media_stop — media control
- media_volume — set volume (volume: 0-100)
- unknown — if the command is not a smart home command

Optional fields: area (room name in snake_case), device (specific device name), scene, brightness, color, volume.

Examples:
User: "turn off the lights"
{"action":"light_off","raw":"turn off the lights"}

User: "dim the bedroom lights to 50%"
{"action":"light_dim","area":"bedroom","brightness":128,"raw":"dim the bedroom lights to 50%"}

User: "activate cyberpunk scene"
{"action":"scene_activate","scene":"cyberpunk","raw":"activate cyberpunk scene"}

Respond with JSON only. No explanation, no markdown.`;

export async function parseIntent(text: string): Promise<Intent> {
  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
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
