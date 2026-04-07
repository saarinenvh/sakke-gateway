const baseUrl = process.env.HA_BASE_URL ?? "http://localhost:8123";
const token = process.env.HA_TOKEN ?? "";

export interface LightEntity {
  entity_id: string;
  name: string;
  area?: string;
}

export interface SwitchEntity {
  entity_id: string;
  name: string;
}

export interface AreaInfo {
  area_id: string;
  name: string;
}

export interface SceneEntity {
  entity_id: string;
  name: string;
  scene_id: string;
}

let lightsCache: LightEntity[] = [];
let switchesCache: SwitchEntity[] = [];
let allSwitchesCache: SwitchEntity[] = [];
let areasCache: AreaInfo[] = [];
let scenesCache: SceneEntity[] = [];

async function haGet<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HA API ${res.status} at ${path}`);
  return res.json() as Promise<T>;
}

async function haTemplate(template: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/template`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ template }),
  });
  if (!res.ok) throw new Error(`HA template API ${res.status}`);
  return res.text();
}

export async function loadEntities(): Promise<void> {
  const states = await haGet<any[]>("/api/states");

  // Get area name for each light entity via template
  const lightStates = states.filter((s: any) =>
    s.entity_id.startsWith("light.") &&
    !s.entity_id.includes("_segment_")
  );

  // Build area map using template API
  const areaMap = new Map<string, string>();
  const areaTemplate = lightStates
    .map(s => `${s.entity_id}:{{ area_name('${s.entity_id}') or '' }}`)
    .join("\n");

  try {
    const areaResult = await haTemplate(areaTemplate);
    for (const line of areaResult.split("\n")) {
      const [entityId, areaName] = line.split(":");
      if (entityId && areaName) areaMap.set(entityId.trim(), areaName.trim());
    }
  } catch {
    // area info is optional, continue without it
  }

  // Collect unique areas
  const areaSet = new Set<string>();
  for (const area of areaMap.values()) {
    if (area) areaSet.add(area);
  }
  areasCache = [...areaSet].map(name => ({
    area_id: name.toLowerCase().replace(/\s+/g, "_"),
    name,
  }));

  lightsCache = lightStates.map((s: any) => ({
    entity_id: s.entity_id,
    name: s.attributes?.friendly_name ?? s.entity_id,
    area: areaMap.get(s.entity_id) || undefined,
  }));

  const allSwitches = states
    .filter((s: any) => s.entity_id.startsWith("switch."))
    .map((s: any) => ({
      entity_id: s.entity_id,
      name: s.attributes?.friendly_name ?? s.entity_id,
    }));

  allSwitchesCache = allSwitches;

  switchesCache = allSwitches.filter((s) =>
    !s.entity_id.includes("_music_mode") &&
    !s.entity_id.includes("_dreamview")
  );

  scenesCache = states
    .filter((s: any) => s.entity_id.startsWith("scene."))
    .map((s: any) => ({
      entity_id: s.entity_id,
      name: s.attributes?.friendly_name ?? s.entity_id,
      scene_id: s.entity_id.replace("scene.", ""),
    }));
}

export function getLights(): LightEntity[] {
  return lightsCache;
}

export function getSwitches(): SwitchEntity[] {
  return switchesCache;
}

export function getAllSwitches(): SwitchEntity[] {
  return allSwitchesCache;
}

export function getAreas(): AreaInfo[] {
  return areasCache;
}

export function getScenes(): SceneEntity[] {
  return scenesCache;
}
