import { config } from "../../config.js";
import { getVacuums, type VacuumEntity } from "../../integrations/homeAssistant/registry.js";

export type VacuumLookup =
  | { kind: "found"; vacuum: VacuumEntity }
  | { kind: "none" }
  | { kind: "ambiguous"; names: string[] };

// The configured vacuum, else the only one HA has; several is ambiguous.
export function findVacuum(): VacuumLookup {
  const vacuums = getVacuums();
  const configured = config.tidiness.vacuumEntityId;

  if (configured !== undefined) {
    const match = vacuums.find(v => v.entity_id === configured);
    // Trust configuration even if the registry failed to load.
    return { kind: "found", vacuum: match ?? { entity_id: configured, name: configured } };
  }

  if (vacuums.length === 0) return { kind: "none" };
  if (vacuums.length > 1) return { kind: "ambiguous", names: vacuums.map(v => v.name) };
  return { kind: "found", vacuum: vacuums[0] };
}

// The name the owner gives it in HA ("James"), or none if HA only has the id.
export function spokenVacuumName(vacuum: VacuumEntity): string | undefined {
  return vacuum.name === vacuum.entity_id ? undefined : vacuum.name;
}

export function findSpokenVacuumName(): string | undefined {
  const lookup = findVacuum();
  return lookup.kind === "found" ? spokenVacuumName(lookup.vacuum) : undefined;
}
