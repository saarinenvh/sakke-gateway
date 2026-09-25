import { readFileSync } from "fs";
import { join } from "path";
import { getLights } from "../integrations/homeAssistant/registry.js";
import { moduleLog } from "../logger.js";
import { config } from "../config.js";

// Scene design is a big single completion, so more generous than the 5-8s used
// for the quick HA/Spotify calls.
const SCENE_DESIGN_TIMEOUT_MS = 30000;

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

// The lamp descriptions live in the wiki when one is mounted, so moving a lamp
// or re-describing a room is an Obsidian edit rather than a redeploy. The copies
// bundled here are the fallback: the wiki is a mounted volume and can simply be
// absent (the dev machine has none), and scene design must not break because of
// that.
//
// The designer briefing is NOT wiki content and deliberately stays in the repo -
// "think like a lighting designer", the JSON output shape, the WiZ effect-speed
// semantics. That's behaviour, and changing it is a code change.
// Its own folder, deliberately not under home/ and deliberately NOT listed in
// the vault's index.md. index.md is injected into the voice agent's system
// prompt as its get_context menu; these two files are read straight off disk by
// the scene designer and are 12KB the agent has no use for. Obsidian shows them
// in the file tree regardless.
const WIKI_LIGHTING_DIR = "lighting-designer";

// Obsidian frontmatter is bookkeeping for the vault - id, summary, which file
// shadows which. The whole document is sent to GPT-4o, so left in place it
// would arrive as several hundred bytes of instructions-shaped noise at the top
// of the lighting brief. Stripped here rather than left out of the files,
// because the metadata is genuinely useful to a human opening the vault.
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  return end === -1 ? content : content.slice(end + 4).trimStart();
}

function readLightingDoc(name: string, log: (source: string) => void): string {
  const wikiPath = join(config.wikiRoot, WIKI_LIGHTING_DIR, name);
  try {
    const content = readFileSync(wikiPath, "utf-8");
    log(wikiPath);
    return stripFrontmatter(content);
  } catch {
    const bundled = join(__dirname, "prompts", name);
    log(`${bundled} (bundled fallback - no wiki copy)`);
    return stripFrontmatter(readFileSync(bundled, "utf-8"));
  }
}

function loadPrompt(): string {
  const sources: string[] = [];
  const note = (s: string) => sources.push(s);

  const context = readLightingDoc("lighting_context.md", note);
  const layout = readLightingDoc("lighting_layout.md", note);
  const template = readFileSync(join(__dirname, "prompts/lighting_designer_prompt.md"), "utf-8");

  moduleLog().info({ sources }, "Loaded lighting design context");
  return template.replace("{{lighting_context}}", `${context}\n\n${layout}`);
}

export async function designScene(description: string): Promise<ScenePlan> {
  const systemPrompt = loadPrompt();

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.openai.lightingModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: description },
      ],
      ...(config.openai.lightingModel.startsWith("o") ? {} : { temperature: 0.7 }),
    }),
    // Every other outbound call in this service has a deadline; this one could
    // hang the whole conversation turn waiting on OpenAI.
    signal: AbortSignal.timeout(SCENE_DESIGN_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);

  moduleLog().info({ model: config.openai.lightingModel }, "OpenAI scene design call completed");

  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  const content = json?.choices?.[0]?.message?.content?.trim() ?? "";
  moduleLog().debug({ response: content }, "OpenAI scene response");

  const cleaned = content.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

  try {
    return JSON.parse(cleaned) as ScenePlan;
  } catch {
    throw new Error(`Failed to parse scene plan: ${content}`);
  }
}

export async function applyScene(plan: ScenePlan): Promise<void> {
  // Step 1: turn off all known lights first, then apply scene — avoids race conditions with group entities
  await Promise.all(getLights().map(async (light) => {
    try {
      await callHA("light", "turn_off", { entity_id: light.entity_id });
    } catch (err: any) {
      moduleLog().error({ entityId: light.entity_id, err: err.message }, "Failed to turn off light before applying scene");
    }
  }));

  // Step 2: apply planned lights
  await Promise.all(plan.lights.map(async (light) => {
    try {
      if (light.value !== undefined) {
        await callHA("number", "set_value", { entity_id: light.entity_id, value: light.value });
        return;
      }

      if (light.state === "off") return;

      const body: Record<string, unknown> = { entity_id: light.entity_id };
      if (light.brightness !== undefined) body.brightness = light.brightness;
      const isWhite = light.color?.[0] === 255 && light.color?.[1] === 255 && light.color?.[2] === 255;
      if (light.color && !isWhite) body.rgb_color = light.color;
      if (light.effect) body.effect = light.effect;

      await callHA("light", "turn_on", body);
    } catch (err: any) {
      moduleLog().error({ entityId: light.entity_id, err: err.message }, "Failed to apply light in scene");
    }
  }));
}

export async function saveCurrentStateAsScene(name: string, entityIds: string[]): Promise<string> {
  const sceneId = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

  const res = await fetch(`${config.ha.baseUrl}/api/states`, {
    headers: { Authorization: `Bearer ${config.ha.token}` },
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

  const configRes = await fetch(`${config.ha.baseUrl}/api/config/scene/config/${sceneId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.ha.token}`,
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
  const res = await fetch(`${config.ha.baseUrl}/api/services/${domain}/${service}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.ha.token}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HA API ${res.status}: ${body}`);
  }
}
