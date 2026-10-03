import { describe, it, expect } from "vitest";
import { tools } from "./registry.js";

// The tool definitions are what the model sees, so a change to them changes how
// it behaves. Most are generated from Zod schemas; this snapshot makes any change
// to the generated result show up in review. Keys are sorted because JSON key
// order carries no meaning here.
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  return sorted;
}

describe("tool definitions", () => {
  it("match the reviewed snapshot", async () => {
    await expect(JSON.stringify(sortKeys(tools), null, 2) + "\n").toMatchFileSnapshot("__snapshots__/toolDefinitions.json");
  });
});
