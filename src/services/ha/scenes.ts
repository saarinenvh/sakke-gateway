import { readFileSync } from "fs";
import { join } from "path";

const openAiApiKey = process.env.OPENAI_API_KEY ?? "";
const openAiModel = process.env.OPENAI_LIGHTING_MODEL ?? "gpt-4o";
const haBaseUrl = process.env.HA_BASE_URL ?? "http://localhost:8123";
const haToken = process.env.HA_TOKEN ?? "";

export interface LightSetting {
  entity_id: string;
  state?: "on" | "off";
  brightness?: number;
  color?: [number, number, number];
  effect?: string;
  value?: number;
}

export interface ScenePlan {
  name: string;
  description: string;
  lights: LightSetting[];
}

function loadPrompt(): string {
  const context = readFileSync(join(__dirname, "../../prompts/lighting/lightning_context.md"), "utf-8");
  const layout = readFileSync(join(__dirname, "../../prompts/lighting/lightning_layout.md"), "utf-8");
  const template = readFileSync(join(__dirname, "../../prompts/lighting/lightning_designer_prompt.md"), "utf-8");
  return template.replace("{{lighting_context}}", `${context}\n\n${layout}`);
}

export async function designScene(description: string): Promise<ScenePlan> {
  const systemPrompt = loadPrompt();

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openAiApiKey}`,
    },
    body: JSON.stringify({
      model: openAiModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: description },
      ],
      temperature: 0.7,
    }),
  });

  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);

  console.log(`🎨 OpenAI scene design call completed (model: ${openAiModel})`);

  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  const content = json?.choices?.[0]?.message?.content?.trim() ?? "";
  console.log(`🎨 OpenAI scene response: ${content.slice(0, 200)}...`);

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
      if (light.value !== undefined) {
        await callHA("number", "set_value", { entity_id: light.entity_id, value: light.value });
        return;
      }

      if (light.state === "off") {
        await callHA("light", "turn_off", { entity_id: light.entity_id });
        return;
      }

      const body: Record<string, unknown> = { entity_id: light.entity_id };
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
    const colorMode = attrs.color_mode;
    if (colorMode === "color_temp") {
      if (attrs.color_temp_kelvin !== undefined) entry.color_temp_kelvin = attrs.color_temp_kelvin;
      else if (attrs.color_temp !== undefined) entry.color_temp = attrs.color_temp;
    } else if (colorMode === "rgb" || colorMode === "rgbw" || colorMode === "rgbww") {
      if (attrs.rgb_color) entry.rgb_color = attrs.rgb_color;
    } else if (colorMode === "hs") {
      if (attrs.hs_color) entry.hs_color = attrs.hs_color;
    } else if (colorMode === "xy") {
      if (attrs.xy_color) entry.xy_color = attrs.xy_color;
    } else if (colorMode === "brightness") {
      // brightness only, no color to save
    } else {
      if (attrs.rgb_color) entry.rgb_color = attrs.rgb_color;
    }
    if (attrs.effect && attrs.effect !== "None" && attrs.effect !== "off") entry.effect = attrs.effect;
    entities[state.entity_id] = entry;
  }

  console.log(`💡 Scene save entities:`, JSON.stringify(entities, null, 2));

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
