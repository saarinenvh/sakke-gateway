import { describe, it, expect } from "vitest";
import { matchArea } from "./registry.js";
import type { AreaInfo } from "./registry.js";

// Real shape from the live instance: HA's area_id is assigned at creation and
// survives a rename, so it is not always the slugified friendly name.
const AREAS: AreaInfo[] = [
  { area_id: "living_room", name: "Living Room" },
  { area_id: "kitchen", name: "Kitchen" },
  { area_id: "bedroom", name: "Bedroom" },
  { area_id: "hall", name: "Hall" },
  // The case the whole fix exists for: renamed after creation, so the id and
  // the name no longer correspond.
  { area_id: "office", name: "Guest Room" },
];

describe("matchArea", () => {
  it("matches the real area_id", () => {
    expect(matchArea("living_room", AREAS)?.area_id).toBe("living_room");
  });

  it("matches the friendly name", () => {
    expect(matchArea("Living Room", AREAS)?.area_id).toBe("living_room");
  });

  it("matches a friendly name the model spelled with spaces instead of underscores", () => {
    expect(matchArea("living room", AREAS)?.area_id).toBe("living_room");
  });

  it.each(["LIVING_ROOM", "Living_Room", "living room ", "  Living Room"])(
    "is case- and whitespace-insensitive: %o", (query) => {
      expect(matchArea(query, AREAS)?.area_id).toBe("living_room");
    });

  it("finds a renamed area by either its id or its current name", () => {
    expect(matchArea("office", AREAS)?.name).toBe("Guest Room");
    expect(matchArea("Guest Room", AREAS)?.area_id).toBe("office");
  });

  // This is the point of the function. An unknown area_id is not an error to
  // Home Assistant - it answers 200 having done nothing - so a guess here
  // surfaces as Sakke confidently confirming an action that never happened.
  it("returns undefined rather than guessing at an unknown area", () => {
    expect(matchArea("olohuone", AREAS)).toBeUndefined();
    expect(matchArea("garage", AREAS)).toBeUndefined();
  });

  it("does not partially match", () => {
    expect(matchArea("living", AREAS)).toBeUndefined();
    expect(matchArea("room", AREAS)).toBeUndefined();
  });

  it("returns undefined when the registry is empty, rather than throwing", () => {
    // Happens when both area templates failed at startup.
    expect(matchArea("living_room", [])).toBeUndefined();
  });

  it("handles an empty query", () => {
    expect(matchArea("", AREAS)).toBeUndefined();
    expect(matchArea("   ", AREAS)).toBeUndefined();
  });
});
