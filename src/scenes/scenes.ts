import { readFileSync } from "fs";
import { join } from "path";
import { getLights, getNumberEntities } from "../integrations/homeAssistant/registry.js";
import { moduleLog } from "../logger.js";
import { config } from "../config.js";
import { getAllStates, callService, haPost } from "../integrations/homeAssistant/client.js";
import { chatCompletion } from "../integrations/openai/client.js";
import { readWikiDocWithFallback } from "../wiki/wiki.js";
import { stripCodeFence } from "../util/text.js";
import { validateScenePlan, InvalidScenePlanError, type ScenePlanIssue } from "./sceneValidator.js";

export { validateScenePlan, InvalidScenePlanError };
export type { ScenePlanIssue };

export interface LightOnOffSetting {
  kind: "light";
  entity_id: string;
  state?: "on" | "off";
  brightness?: number;
  color?: [number, number, number];
  effect?: string;
}

export interface NumberEntitySetting {
  kind: "number";
  entity_id: string;
  value: number;
}

export type LightSetting = LightOnOffSetting | NumberEntitySetting;

export interface ScenePlan {
  name: string;
  description: string;
  lights: LightSetting[];
}

export interface SceneDeviceOutcome {
  entity_id: string;
  ok: boolean;
  error?: string;
}

export interface ApplySceneResult {
  outcomes: SceneDeviceOutcome[];
  allSucceeded: boolean;
  anySucceeded: boolean;
}

// Scene design is a big single completion, so more generous than the 5-8s used
// for the quick HA/Spotify calls.
const SCENE_DESIGN_TIMEOUT_MS = 30000;

// The lamp descriptions live in the wiki when one is mounted, so moving a lamp
// or re-describing a room is an Obsidian edit rather than a redeploy - see
// readWikiDocWithFallback for the bundled-copy fallback.
//
// The designer briefing itself is NOT wiki content and deliberately stays in
// the repo - "think like a lighting designer", the JSON output shape, the WiZ
// effect-speed semantics. That's behaviour, and changing it is a code change.
const WIKI_LIGHTING_DIR = "lighting-designer";
const BUNDLED_LIGHTING_DIR = join(__dirname, "prompts");

export async function designScene(description: string): Promise<ScenePlan> {
  const systemPrompt = loadPrompt();

  // Every other outbound call in this service has a deadline; this one could
  // hang the whole conversation turn waiting on OpenAI.
  const content = await chatCompletion(
    config.openai.lightingModel,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: description },
    ],
    { temperature: 0.7, timeoutMs: SCENE_DESIGN_TIMEOUT_MS },
  );

  moduleLog().info({ model: config.openai.lightingModel }, "OpenAI scene design call completed");
  moduleLog().debug({ response: content }, "OpenAI scene response");

  return validateScenePlan(parseSceneJson(content), ...knownEntityIds());
}

export async function applyScene(plan: ScenePlan): Promise<ApplySceneResult> {
  // Re-validated here, not just in designScene() - callers touch real devices
  // through this function, so "an invalid plan makes zero mutations" has to
  // hold as a property of applyScene() itself, not just of its one caller.
  const validated = validateScenePlan(plan, ...knownEntityIds());

  const offOutcomes = await turnOffAllLights();
  const offOutcomeByEntity = new Map(offOutcomes.map(outcome => [outcome.entity_id, outcome]));

  const planEntityIds = new Set(validated.lights.map(light => light.entity_id));
  // A light the plan never mentions is still part of the intended final scene
  // - "off" - so a failed shutdown for it belongs in the result too, not just
  // logged and forgotten.
  const backgroundOffOutcomes = offOutcomes.filter(outcome => !planEntityIds.has(outcome.entity_id));

  const planOutcomes = await Promise.all(
    validated.lights.map(light => applySceneDevice(light, offOutcomeByEntity.get(light.entity_id))),
  );

  return summarizeOutcomes([...backgroundOffOutcomes, ...planOutcomes]);
}

export async function saveCurrentStateAsScene(name: string, entityIds: string[]): Promise<string> {
  const sceneId = createSceneId(name);
  const states = await getAllStates() as { entity_id: string; state: string; attributes?: HomeAssistantLightAttributes }[];

  const entities = Object.fromEntries(
    states
      .filter(state => entityIds.includes(state.entity_id))
      .map(state => [state.entity_id, stateToSceneEntity(state)]),
  );

  await saveScene(sceneId, name, entities);

  return `scene.${sceneId}`;
}

// --- shared helpers ---

function knownEntityIds(): [lightIds: string[], numberEntityIds: string[]] {
  return [
    getLights().map(light => light.entity_id),
    getNumberEntities().map(entity => entity.entity_id),
  ];
}

// --- designScene helpers ---

function loadPrompt(): string {
  const sources: string[] = [];
  const note = (s: string) => sources.push(s);

  const context = readWikiDocWithFallback(WIKI_LIGHTING_DIR, "lighting_context.md", BUNDLED_LIGHTING_DIR, note);
  const layout = readWikiDocWithFallback(WIKI_LIGHTING_DIR, "lighting_layout.md", BUNDLED_LIGHTING_DIR, note);
  const template = readFileSync(join(__dirname, "prompts/lighting_designer_prompt.md"), "utf-8");

  moduleLog().info({ sources }, "Loaded lighting design context");
  return template.replace("{{lighting_context}}", `${context}\n\n${layout}`);
}

function parseSceneJson(content: string): unknown {
  try {
    return JSON.parse(stripCodeFence(content));
  } catch {
    throw new Error(`Failed to parse scene plan: ${content}`);
  }
}

// --- applyScene helpers ---

async function turnOffLight(entityId: string): Promise<SceneDeviceOutcome> {
  try {
    await callService("light", "turn_off", { entity_id: entityId });
    return { entity_id: entityId, ok: true };
  } catch (err: any) {
    moduleLog().error({ entityId, err: err.message }, "Failed to turn off light before applying scene");
    return { entity_id: entityId, ok: false, error: err.message };
  }
}

// Turned off first, then the scene's own lights are applied - avoids race
// conditions with group entities. Outcomes are returned, not just logged, so
// a light that was supposed to end up off - because the plan says so, or
// because it's simply not mentioned - can't be silently reported as applied
// when this step actually failed.
async function turnOffAllLights(): Promise<SceneDeviceOutcome[]> {
  return Promise.all(getLights().map(light => turnOffLight(light.entity_id)));
}

function getLightTurnOnBody(light: LightOnOffSetting): Record<string, unknown> {
  const isWhite = light.color?.[0] === 255 && light.color?.[1] === 255 && light.color?.[2] === 255;
  return {
    entity_id: light.entity_id,
    ...(light.brightness !== undefined && { brightness: light.brightness }),
    ...(light.color && !isWhite && { rgb_color: light.color }),
    ...(light.effect && { effect: light.effect }),
  };
}

async function applyNumberSetting(setting: NumberEntitySetting): Promise<SceneDeviceOutcome> {
  await callService("number", "set_value", { entity_id: setting.entity_id, value: setting.value });
  return { entity_id: setting.entity_id, ok: true };
}

async function applyLightSetting(light: LightOnOffSetting, offOutcome?: SceneDeviceOutcome): Promise<SceneDeviceOutcome> {
  if (light.state === "off") {
    // Already turned off in the pre-scene step - report that outcome rather
    // than assuming it worked.
    return offOutcome ?? { entity_id: light.entity_id, ok: true };
  }
  await callService("light", "turn_on", getLightTurnOnBody(light));
  return { entity_id: light.entity_id, ok: true };
}

async function applySceneDevice(setting: LightSetting, offOutcome?: SceneDeviceOutcome): Promise<SceneDeviceOutcome> {
  try {
    return setting.kind === "number" ? await applyNumberSetting(setting) : await applyLightSetting(setting, offOutcome);
  } catch (err: any) {
    moduleLog().error({ entityId: setting.entity_id, err: err.message }, "Failed to apply light in scene");
    return { entity_id: setting.entity_id, ok: false, error: err.message };
  }
}

function summarizeOutcomes(outcomes: SceneDeviceOutcome[]): ApplySceneResult {
  return {
    outcomes,
    allSucceeded: outcomes.every(o => o.ok),
    anySucceeded: outcomes.some(o => o.ok),
  };
}

// --- saveCurrentStateAsScene helpers ---

function createSceneId(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

interface HomeAssistantLightAttributes {
  brightness?: number;
  color_mode?: "color_temp" | "rgb" | "rgbw" | "rgbww" | "hs" | "xy" | "brightness";
  color_temp_kelvin?: number;
  color_temp?: number;
  rgb_color?: [number, number, number];
  hs_color?: [number, number];
  xy_color?: [number, number];
  effect?: string;
}

function getColorAttributes(attrs: HomeAssistantLightAttributes): Record<string, unknown> {
  switch (attrs.color_mode) {
    case "color_temp":
      if (attrs.color_temp_kelvin !== undefined) return { color_temp_kelvin: attrs.color_temp_kelvin };
      if (attrs.color_temp !== undefined) return { color_temp: attrs.color_temp };
      return {};

    case "rgb":
    case "rgbw":
    case "rgbww":
      return attrs.rgb_color ? { rgb_color: attrs.rgb_color } : {};

    case "hs":
      return attrs.hs_color ? { hs_color: attrs.hs_color } : {};

    case "xy":
      return attrs.xy_color ? { xy_color: attrs.xy_color } : {};

    case "brightness":
      return {};

    // Unknown/missing color mode - rgb_color is the safest guess if HA gave one.
    default:
      return attrs.rgb_color ? { rgb_color: attrs.rgb_color } : {};
  }
}

function hasEffect(effect?: string): boolean {
  return !!effect && effect !== "None" && effect !== "off";
}

function stateToSceneEntity(state: { state: string; attributes?: HomeAssistantLightAttributes }): Record<string, unknown> {
  const attrs = state.attributes ?? {};
  return {
    state: state.state,
    ...(attrs.brightness !== undefined && { brightness: attrs.brightness }),
    ...getColorAttributes(attrs),
    ...(hasEffect(attrs.effect) && { effect: attrs.effect }),
  };
}

async function saveScene(sceneId: string, name: string, entities: Record<string, unknown>): Promise<void> {
  await haPost(`/api/config/scene/config/${sceneId}`, { id: sceneId, name, entities });
}
