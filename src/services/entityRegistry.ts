const baseUrl = process.env.HA_BASE_URL ?? "http://localhost:8123";
const token = process.env.HA_TOKEN ?? "";

export interface LightEntity {
  entity_id: string;
  name: string;
  area?: string;
}

export interface AreaInfo {
  area_id: string;
  name: string;
}

let lightsCache: LightEntity[] = [];
let areasCache: AreaInfo[] = [];

async function haGet<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HA API ${res.status} at ${path}`);
  return res.json() as Promise<T>;
}

export async function loadEntities(): Promise<void> {
  const [states, entityRegistry, areaRegistry] = await Promise.all([
    haGet<any[]>("/api/states"),
    haGet<any[]>("/api/config/entity_registry"),
    haGet<any[]>("/api/config/area_registry"),
  ]);

  areasCache = areaRegistry.map((a: any) => ({ area_id: a.area_id, name: a.name }));

  const areaById = new Map(areasCache.map(a => [a.area_id, a.name]));

  // Build entity_id -> area_id from entity registry
  const entityAreaMap = new Map<string, string>();
  for (const e of entityRegistry) {
    if (e.area_id) entityAreaMap.set(e.entity_id, e.area_id);
  }

  lightsCache = states
    .filter((s: any) =>
      s.entity_id.startsWith("light.") &&
      !s.entity_id.includes("_segment_")
    )
    .map((s: any) => {
      const areaId = entityAreaMap.get(s.entity_id);
      return {
        entity_id: s.entity_id,
        name: s.attributes?.friendly_name ?? s.entity_id,
        area: areaId ? areaById.get(areaId) : undefined,
      };
    });
}

export function getLights(): LightEntity[] {
  return lightsCache;
}

export function getAreas(): AreaInfo[] {
  return areasCache;
}
