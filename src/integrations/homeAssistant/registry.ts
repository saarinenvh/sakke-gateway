import { config } from "../../config.js";

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

export interface ScriptEntity {
  entity_id: string;
  name: string;
  script_id: string;
}

let lightsCache: LightEntity[] = [];
let switchesCache: SwitchEntity[] = [];
let allSwitchesCache: SwitchEntity[] = [];
let areasCache: AreaInfo[] = [];
let scenesCache: SceneEntity[] = [];
let scriptsCache: ScriptEntity[] = [];

async function haGet<T>(path: string): Promise<T> {
  const res = await fetch(`${config.ha.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${config.ha.token}` },
  });
  if (!res.ok) throw new Error(`HA API ${res.status} at ${path}`);
  return res.json() as Promise<T>;
}

async function haTemplate(template: string): Promise<string> {
  const res = await fetch(`${config.ha.baseUrl}/api/template`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.ha.token}`,
    },
    body: JSON.stringify({ template }),
  });
  if (!res.ok) throw new Error(`HA template API ${res.status}`);
  return res.text();
}

export async function loadEntities(): Promise<void> {
  const states = await haGet<any[]>("/api/states");

  const lightStates = states.filter((s: any) =>
    s.entity_id.startsWith("light.") &&
    !s.entity_id.includes("_segment_") &&
    !s.attributes?.entity_ids
  );

  // One template call returns the whole area registry plus each area's
  // entities, which replaces two separate guesses that were both wrong:
  //
  //   - area_id was derived by slugifying the friendly name. HA assigns
  //     area_id at creation and keeps it across renames, so that only held
  //     until someone renamed an area - and a wrong area_id isn't an error to
  //     HA, it answers 200 having done nothing, surfacing as Sakke confirming
  //     an action that never happened.
  //   - the list of areas was inferred from whichever entities were lights, so
  //     an area containing only a switch or a media player didn't exist as far
  //     as Sakke was concerned.
  //
  // Pipe-separated because an area name may contain a colon; entity ids cannot
  // contain either.
  const areaMap = new Map<string, { id: string; name: string }>();
  const areaTemplate = `{% for a in areas() %}{{ a }}|{{ area_name(a) }}|{{ area_entities(a) | join(',') }}
{% endfor %}`;

  const byId = new Map<string, AreaInfo>();
  try {
    const areaResult = await haTemplate(areaTemplate);
    for (const line of areaResult.split("\n")) {
      const [areaId, areaName, entityIds] = line.split("|");
      if (!areaId?.trim() || !areaName?.trim()) continue;
      const id = areaId.trim();
      const name = areaName.trim();
      byId.set(id, { area_id: id, name });
      for (const entityId of (entityIds ?? "").split(",")) {
        if (entityId.trim()) areaMap.set(entityId.trim(), { id, name });
      }
    }
  } catch {
    // handled by the fallback below
  }

  // Per-entity fallback, using only area_name/area_id - the functions this code
  // already relied on before. areas()/area_entities() are the better source but
  // are newer, and since resolveArea now REFUSES areas it doesn't recognise, an
  // empty registry would turn every area-scoped command into a hard failure.
  // Worth the few extra lines not to make that depend on one template call.
  if (byId.size === 0 && lightStates.length > 0) {
    const perEntityTemplate = lightStates
      .map(s => `${s.entity_id}|{{ area_name('${s.entity_id}') or '' }}|{{ area_id('${s.entity_id}') or '' }}`)
      .join("\n");
    try {
      const result = await haTemplate(perEntityTemplate);
      for (const line of result.split("\n")) {
        const [entityId, areaName, areaId] = line.split("|");
        if (!entityId?.trim() || !areaName?.trim()) continue;
        const name = areaName.trim();
        const id = areaId?.trim() || name.toLowerCase().replace(/\s+/g, "_");
        byId.set(id, { area_id: id, name });
        areaMap.set(entityId.trim(), { id, name });
      }
    } catch {
      // Neither worked - area-scoped commands will say the area is unknown
      // rather than acting on the wrong one.
    }
  }

  areasCache = [...byId.values()];

  lightsCache = lightStates.map((s: any) => ({
    entity_id: s.entity_id,
    name: s.attributes?.friendly_name ?? s.entity_id,
    area: areaMap.get(s.entity_id)?.name || undefined,
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

  scriptsCache = states
    .filter((s: any) => s.entity_id.startsWith("script."))
    .map((s: any) => ({
      entity_id: s.entity_id,
      name: s.attributes?.friendly_name ?? s.entity_id,
      script_id: s.entity_id.replace("script.", ""),
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

export function getScripts(): ScriptEntity[] {
  return scriptsCache;
}

// Matches whatever the model supplied against the real area registry - it is
// told the area_id in the system prompt but will sometimes send the friendly
// name, or a name with spaces where the id has underscores. Returns undefined
// rather than guessing, so callers can fail loudly instead of sending HA an
// area that doesn't exist.
export function resolveArea(query: string): AreaInfo | undefined {
  const q = query.trim().toLowerCase();
  const slug = q.replace(/\s+/g, "_");
  return areasCache.find(a =>
    a.area_id.toLowerCase() === q ||
    a.area_id.toLowerCase() === slug ||
    a.name.toLowerCase() === q
  );
}
