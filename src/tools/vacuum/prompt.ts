import { findSpokenVacuumName } from "../../features/tidiness/vacuum.js";

export function vacuumPrompt(): string {
  const name = findSpokenVacuumName();
  if (!name) return "";
  return `Robot vacuum: it is called ${name}. "${name}, clean the house", "send ${name} home" or "where's ${name}?" are vacuum tool requests. Refer to it as ${name}.`;
}
