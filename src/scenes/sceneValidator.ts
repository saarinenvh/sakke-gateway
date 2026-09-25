import type { LightSetting, LightOnOffSetting, ScenePlan } from "./scenes.js";

export interface ScenePlanIssue {
  path: string;
  message: string;
}

// Thrown by validateScenePlan - carries every problem found, not just the
// first, so a bad GPT-4o response can be debugged from one log line instead
// of a fix-one-rerun-find-the-next loop.
export class InvalidScenePlanError extends Error {
  constructor(readonly issues: ScenePlanIssue[]) {
    super(`Invalid scene plan: ${issues.map(i => `${i.path}: ${i.message}`).join("; ")}`);
    this.name = "InvalidScenePlanError";
  }
}

// The only documented use of number.* entities is WiZ effect speed
// (lighting_context.md) - matched by naming convention AND checked against
// the real number-entity registry, the same way light.* is checked against
// knownLightIds. Naming convention alone would let a plausible-looking but
// nonexistent entity id (a GPT-4o hallucination) pass validation, only to
// fail once real lights have already been turned off in applyScene()'s first
// step - exactly the "mutate before knowing it'll work" bug this file exists
// to prevent.
const EFFECT_SPEED_ENTITY = /^number\.[a-z0-9_]+_effect_speed$/;
const EFFECT_SPEED_RANGE = { min: 10, max: 200 };
const BRIGHTNESS_RANGE = { min: 0, max: 255 };
const COLOR_CHANNEL_RANGE = { min: 0, max: 255 };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

// Validates a parsed scene plan against required fields, known entity ids/
// domains, and the value ranges the lighting designer prompt documents -
// before any device is touched. An invalid plan throws and produces zero
// mutations; there is no partial/best-effort acceptance of a malformed plan.
//
// knownLightIds/knownNumberEntityIds are passed in rather than read from the
// registry here, the same way registry.ts's matchArea was split out from
// resolveArea - so the validation rules can be tested without standing up a
// Home Assistant to populate the cache.
export function validateScenePlan(
  raw: unknown,
  knownLightIds: Iterable<string>,
  knownNumberEntityIds: Iterable<string>,
): ScenePlan {
  const issues: ScenePlanIssue[] = [];

  if (!isPlainObject(raw)) {
    throw new InvalidScenePlanError([{ path: "$", message: "plan is not an object" }]);
  }

  // Always a string (never undefined) so the final return needs no non-null
  // assertion - issues.length is checked before that return, so an empty
  // placeholder here never actually leaks out.
  const name = typeof raw.name === "string" ? raw.name : "";
  if (name.trim() === "") issues.push({ path: "name", message: "must be a non-empty string" });

  const description = typeof raw.description === "string" ? raw.description : "";
  if (description.trim() === "") issues.push({ path: "description", message: "must be a non-empty string" });

  const knownLightIdSet = new Set(knownLightIds);
  const knownNumberEntityIdSet = new Set(knownNumberEntityIds);
  const seenEntityIds = new Set<string>();
  const lights: LightSetting[] = [];

  if (!Array.isArray(raw.lights) || raw.lights.length === 0) {
    issues.push({ path: "lights", message: "must be a non-empty array" });
  } else {
    raw.lights.forEach((entry, i) => {
      const path = `lights[${i}]`;
      if (!isPlainObject(entry)) {
        issues.push({ path, message: "must be an object" });
        return;
      }

      const entityId = entry.entity_id;
      if (typeof entityId !== "string" || entityId.trim() === "") {
        issues.push({ path: `${path}.entity_id`, message: "must be a non-empty string" });
        return;
      }

      // Two entries for the same entity would both fire through Promise.all in
      // applyScene(), racing each other for the final state - reject rather
      // than leave the outcome dependent on request ordering.
      if (seenEntityIds.has(entityId)) {
        issues.push({ path: `${path}.entity_id`, message: `duplicate entity_id: "${entityId}" (also set by an earlier entry)` });
        return;
      }
      seenEntityIds.add(entityId);

      const isNumberEntity = entityId.startsWith("number.");
      const isLightEntity = entityId.startsWith("light.");

      if (isLightEntity && !knownLightIdSet.has(entityId)) {
        issues.push({ path: `${path}.entity_id`, message: `unknown light entity: "${entityId}"` });
        return;
      }
      if (isNumberEntity && (!EFFECT_SPEED_ENTITY.test(entityId) || !knownNumberEntityIdSet.has(entityId))) {
        issues.push({ path: `${path}.entity_id`, message: `unsupported number entity: "${entityId}"` });
        return;
      }
      if (!isLightEntity && !isNumberEntity) {
        issues.push({ path: `${path}.entity_id`, message: `unsupported domain: "${entityId}"` });
        return;
      }

      // number entities carry only a value - a WiZ effect-speed knob, not a light.
      if (isNumberEntity) {
        if (!inRange(entry.value, EFFECT_SPEED_RANGE.min, EFFECT_SPEED_RANGE.max)) {
          issues.push({ path: `${path}.value`, message: `must be a number between ${EFFECT_SPEED_RANGE.min} and ${EFFECT_SPEED_RANGE.max}` });
          return;
        }
        lights.push({ kind: "number", entity_id: entityId, value: entry.value });
        return;
      }

      if (entry.value !== undefined) {
        issues.push({ path: `${path}.value`, message: "value is only valid for number.* entities" });
        return;
      }

      const setting: LightOnOffSetting = { kind: "light", entity_id: entityId };

      if (entry.state !== undefined) {
        if (entry.state !== "on" && entry.state !== "off") {
          issues.push({ path: `${path}.state`, message: `must be "on" or "off"` });
        } else {
          setting.state = entry.state;
        }
      }

      if (entry.brightness !== undefined) {
        if (!inRange(entry.brightness, BRIGHTNESS_RANGE.min, BRIGHTNESS_RANGE.max)) {
          issues.push({ path: `${path}.brightness`, message: `must be a number between ${BRIGHTNESS_RANGE.min} and ${BRIGHTNESS_RANGE.max}` });
        } else {
          setting.brightness = entry.brightness;
        }
      }

      if (entry.color !== undefined) {
        const color = entry.color;
        const valid = Array.isArray(color) && color.length === 3 && color.every(c => inRange(c, COLOR_CHANNEL_RANGE.min, COLOR_CHANNEL_RANGE.max));
        if (!valid) {
          issues.push({ path: `${path}.color`, message: "must be [r, g, b] with each channel between 0 and 255" });
        } else {
          setting.color = color as [number, number, number];
        }
      }

      if (entry.effect !== undefined) {
        if (typeof entry.effect !== "string" || entry.effect.trim() === "") {
          issues.push({ path: `${path}.effect`, message: "must be a non-empty string" });
        } else {
          setting.effect = entry.effect;
        }
      }

      lights.push(setting);
    });
  }

  if (issues.length > 0) throw new InvalidScenePlanError(issues);

  return { name, description, lights };
}
