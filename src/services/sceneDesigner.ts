import { readFileSync } from "fs";
import { join } from "path"; // used by loadPrompt
const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const model = process.env.OLLAMA_MODEL ?? "llama3";
const haBaseUrl = process.env.HA_BASE_URL ?? "http://localhost:8123";
const haToken = process.env.HA_TOKEN ?? "";

export interface LightSetting {
  entity_id: string;
  state: "on" | "off";
  brightness?: number;
  color?: [number, number, number];
  effect?: string;
}

export interface ScenePlan {
  name: string;
  description: string;
  lights: LightSetting[];
}

function loadPrompt(): string {
  const context = readFileSync(join(__dirname, "../prompts/lightning_context.md"), "utf-8");
  const template = readFileSync(join(__dirname, "../prompts/lightning_designer_prompt.md"), "utf-8");
  return template.replace("{{lighting_context}}", context);
}

export async function designScene(description: string): Promise<ScenePlan> {
  const systemPrompt = loadPrompt();

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: description },
      ],
      stream: false,
      options: { temperature: 0.7, num_predict: 2000 },
    }),
  });

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);

  const json = await res.json() as { message?: { content?: string } };
  const content = json?.message?.content?.trim() ?? "";

  // Strip markdown code fences if present
  const cleaned = content.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

  try {
    return JSON.parse(cleaned) as ScenePlan;
  } catch {
    throw new Error(`Failed to parse scene plan: ${content}`);
  }
}

export async function applyScene(plan: ScenePlan): Promise<void> {
  await Promise.all(plan.lights.map(async (light) => {
    try {
      const body: Record<string, unknown> = { entity_id: light.entity_id };

      if (light.state === "off") {
        await callHA("light", "turn_off", { entity_id: light.entity_id });
        return;
      }

      if (light.brightness !== undefined) body.brightness = light.brightness;
      if (light.color) body.rgb_color = light.color;
      if (light.effect) body.effect = light.effect;

      await callHA("light", "turn_on", body);
    } catch (err: any) {
      console.error(`Failed to apply light ${light.entity_id}: ${err.message}`);
    }
  }));
}

export async function saveCurrentStateAsScene(name: string, entityIds: string[]): Promise<string> {
  const sceneId = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

  // Fetch current states for all requested entities
  const res = await fetch(`${haBaseUrl}/api/states`, {
    headers: { Authorization: `Bearer ${haToken}` },
  });
  if (!res.ok) throw new Error(`HA API ${res.status}`);
  const states: any[] = await res.json();

  const entities: Record<string, any> = {};
  for (const state of states) {
    if (!entityIds.includes(state.entity_id)) continue;
    const entry: Record<string, any> = { state: state.state };
    const attrs = state.attributes ?? {};
    if (attrs.brightness !== undefined) entry.brightness = attrs.brightness;
    if (attrs.rgb_color) entry.rgb_color = attrs.rgb_color;
    if (attrs.effect && attrs.effect !== "None") entry.effect = attrs.effect;
    entities[state.entity_id] = entry;
  }

  // Use HA config API to create a persistent, editable scene
  const configRes = await fetch(`${haBaseUrl}/api/config/scene/config/${sceneId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${haToken}`,
    },
    body: JSON.stringify({ id: sceneId, name, entities }),
  });

  if (!configRes.ok) {
    const body = await configRes.text();
    throw new Error(`HA config API ${configRes.status}: ${body}`);
  }

  return `scene.${sceneId}`;
}

async function callHA(domain: string, service: string, data: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${haBaseUrl}/api/services/${domain}/${service}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${haToken}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HA API ${res.status}: ${body}`);
  }
}
