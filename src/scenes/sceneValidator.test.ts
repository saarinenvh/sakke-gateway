import { describe, it, expect } from "vitest";
import { validateScenePlan, InvalidScenePlanError } from "./sceneValidator.js";

const KNOWN_LIGHTS = ["light.hue_infuse_ceiling_1", "light.uplighter_floor_lamp"];
const KNOWN_NUMBER_ENTITIES = ["number.wiz_couch_floor_lamp_1_effect_speed", "number.wiz_lamp_effect_speed"];

function issuesOf(fn: () => unknown): { path: string; message: string }[] {
  try {
    fn();
    throw new Error("expected validateScenePlan to throw");
  } catch (err) {
    if (!(err instanceof InvalidScenePlanError)) throw err;
    return err.issues;
  }
}

describe("validateScenePlan", () => {
  it("accepts a well-formed plan and returns only the recognised fields, tagged with their kind", () => {
    const raw = {
      name: "Movie Night",
      description: "Dim, warm, focused on the TV wall.",
      lights: [
        { entity_id: "light.hue_infuse_ceiling_1", brightness: 120, color: [255, 100, 0], extraJunkField: "ignored" },
        { entity_id: "light.uplighter_floor_lamp", state: "off" },
      ],
    };
    const plan = validateScenePlan(raw, KNOWN_LIGHTS, KNOWN_NUMBER_ENTITIES);
    expect(plan).toEqual({
      name: "Movie Night",
      description: "Dim, warm, focused on the TV wall.",
      lights: [
        { kind: "light", entity_id: "light.hue_infuse_ceiling_1", brightness: 120, color: [255, 100, 0] },
        { kind: "light", entity_id: "light.uplighter_floor_lamp", state: "off" },
      ],
    });
  });

  it("accepts a valid, known WiZ effect-speed number entity", () => {
    const raw = {
      name: "Party",
      description: "Fast effects.",
      lights: [{ entity_id: "number.wiz_couch_floor_lamp_1_effect_speed", value: 60 }],
    };
    const plan = validateScenePlan(raw, KNOWN_LIGHTS, KNOWN_NUMBER_ENTITIES);
    expect(plan.lights).toEqual([{ kind: "number", entity_id: "number.wiz_couch_floor_lamp_1_effect_speed", value: 60 }]);
  });

  it("rejects a plan that isn't an object at all", () => {
    const issues = issuesOf(() => validateScenePlan("not a plan", KNOWN_LIGHTS, KNOWN_NUMBER_ENTITIES));
    expect(issues).toEqual([{ path: "$", message: "plan is not an object" }]);
  });

  it("rejects a plan with a missing name and description in one pass", () => {
    const issues = issuesOf(() => validateScenePlan({ lights: [] }, KNOWN_LIGHTS, KNOWN_NUMBER_ENTITIES));
    const paths = issues.map(i => i.path);
    expect(paths).toContain("name");
    expect(paths).toContain("description");
    expect(paths).toContain("lights");
  });

  it("rejects an empty lights array", () => {
    const issues = issuesOf(() => validateScenePlan({ name: "x", description: "y", lights: [] }, KNOWN_LIGHTS, KNOWN_NUMBER_ENTITIES));
    expect(issues).toEqual([{ path: "lights", message: "must be a non-empty array" }]);
  });

  it("rejects a light entity that isn't in the known registry - the actual bug this exists to catch", () => {
    const raw = { name: "x", description: "y", lights: [{ entity_id: "light.hallucinated_lamp" }] };
    const issues = issuesOf(() => validateScenePlan(raw, KNOWN_LIGHTS, KNOWN_NUMBER_ENTITIES));
    expect(issues).toEqual([{ path: "lights[0].entity_id", message: 'unknown light entity: "light.hallucinated_lamp"' }]);
  });

  it("rejects a number entity that doesn't match the effect-speed naming convention", () => {
    const raw = { name: "x", description: "y", lights: [{ entity_id: "number.some_other_thing", value: 50 }] };
    const issues = issuesOf(() => validateScenePlan(raw, KNOWN_LIGHTS, KNOWN_NUMBER_ENTITIES));
    expect(issues).toEqual([{ path: "lights[0].entity_id", message: 'unsupported number entity: "number.some_other_thing"' }]);
  });

  it("rejects a number entity that matches the naming convention but doesn't exist - the hallucination this closes", () => {
    const raw = { name: "x", description: "y", lights: [{ entity_id: "number.nonexistent_effect_speed", value: 60 }] };
    const issues = issuesOf(() => validateScenePlan(raw, KNOWN_LIGHTS, KNOWN_NUMBER_ENTITIES));
    expect(issues).toEqual([{ path: "lights[0].entity_id", message: 'unsupported number entity: "number.nonexistent_effect_speed"' }]);
  });

  it("rejects a number entity value outside the documented 10-200 range", () => {
    const raw = { name: "x", description: "y", lights: [{ entity_id: "number.wiz_lamp_effect_speed", value: 500 }] };
    const issues = issuesOf(() => validateScenePlan(raw, KNOWN_LIGHTS, KNOWN_NUMBER_ENTITIES));
    expect(issues).toEqual([{ path: "lights[0].value", message: "must be a number between 10 and 200" }]);
  });

  it("rejects an unsupported entity domain", () => {
    const raw = { name: "x", description: "y", lights: [{ entity_id: "switch.tv_backlight" }] };
    const issues = issuesOf(() => validateScenePlan(raw, KNOWN_LIGHTS, KNOWN_NUMBER_ENTITIES));
    expect(issues).toEqual([{ path: "lights[0].entity_id", message: 'unsupported domain: "switch.tv_backlight"' }]);
  });

  it("rejects a light entity that also sets value", () => {
    const raw = { name: "x", description: "y", lights: [{ entity_id: "light.hue_infuse_ceiling_1", value: 5 }] };
    const issues = issuesOf(() => validateScenePlan(raw, KNOWN_LIGHTS, KNOWN_NUMBER_ENTITIES));
    expect(issues).toEqual([{ path: "lights[0].value", message: "value is only valid for number.* entities" }]);
  });

  it("rejects brightness outside 0-255", () => {
    const raw = { name: "x", description: "y", lights: [{ entity_id: "light.hue_infuse_ceiling_1", brightness: 300 }] };
    const issues = issuesOf(() => validateScenePlan(raw, KNOWN_LIGHTS, KNOWN_NUMBER_ENTITIES));
    expect(issues).toEqual([{ path: "lights[0].brightness", message: "must be a number between 0 and 255" }]);
  });

  it("rejects a color that isn't a 3-channel 0-255 tuple", () => {
    const raw = { name: "x", description: "y", lights: [{ entity_id: "light.hue_infuse_ceiling_1", color: [255, 999] }] };
    const issues = issuesOf(() => validateScenePlan(raw, KNOWN_LIGHTS, KNOWN_NUMBER_ENTITIES));
    expect(issues).toEqual([{ path: "lights[0].color", message: "must be [r, g, b] with each channel between 0 and 255" }]);
  });

  it("rejects an empty effect string", () => {
    const raw = { name: "x", description: "y", lights: [{ entity_id: "light.hue_infuse_ceiling_1", effect: "  " }] };
    const issues = issuesOf(() => validateScenePlan(raw, KNOWN_LIGHTS, KNOWN_NUMBER_ENTITIES));
    expect(issues).toEqual([{ path: "lights[0].effect", message: "must be a non-empty string" }]);
  });

  it("rejects an invalid state value", () => {
    const raw = { name: "x", description: "y", lights: [{ entity_id: "light.hue_infuse_ceiling_1", state: "blinking" }] };
    const issues = issuesOf(() => validateScenePlan(raw, KNOWN_LIGHTS, KNOWN_NUMBER_ENTITIES));
    expect(issues).toEqual([{ path: "lights[0].state", message: 'must be "on" or "off"' }]);
  });

  it("rejects the same entity id appearing twice - concurrent commands would race for the final state", () => {
    const raw = {
      name: "x",
      description: "y",
      lights: [
        { entity_id: "light.hue_infuse_ceiling_1", brightness: 10 },
        { entity_id: "light.hue_infuse_ceiling_1", brightness: 255 },
      ],
    };
    const issues = issuesOf(() => validateScenePlan(raw, KNOWN_LIGHTS, KNOWN_NUMBER_ENTITIES));
    expect(issues).toEqual([{ path: "lights[1].entity_id", message: 'duplicate entity_id: "light.hue_infuse_ceiling_1" (also set by an earlier entry)' }]);
  });
});
