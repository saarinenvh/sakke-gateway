import { config } from "../../config.js";
import { getVacuums, type VacuumEntity } from "../../integrations/homeAssistant/registry.js";

export type VacuumLookup =
  | { kind: "found"; vacuum: VacuumEntity }
  | { kind: "none" }
  | { kind: "ambiguous"; names: string[] };

// Which vacuum "the vacuum" means: the configured one, or else the only one
// Home Assistant has. Two or more without configuration is ambiguous rather
// than a guess.
export function findVacuum(): VacuumLookup {
  const vacuums = getVacuums();
  const configured = config.tidiness.vacuumEntityId;

  if (configured !== undefined) {
    const match = vacuums.find(v => v.entity_id === configured);
    // Configured but not (yet) in the registry: trust the configuration, so a
    // registry that failed to load doesn't disable the vacuum.
    return { kind: "found", vacuum: match ?? { entity_id: configured, name: configured } };
  }

  if (vacuums.length === 0) return { kind: "none" };
  if (vacuums.length > 1) return { kind: "ambiguous", names: vacuums.map(v => v.name) };
  return { kind: "found", vacuum: vacuums[0] };
}
