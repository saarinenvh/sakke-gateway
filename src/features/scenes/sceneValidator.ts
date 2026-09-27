import { z } from "zod";
import type { LightSetting, ScenePlan } from "./scenes.js";

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

const LIGHT_DOMAIN_PREFIX = "light.";
const NUMBER_DOMAIN_PREFIX = "number.";

const NON_EMPTY_STRING_MESSAGE = "must be a non-empty string";
const COLOR_MESSAGE = "must be [r, g, b] with each channel between 0 and 255";
const LIGHTS_MESSAGE = "must be a non-empty array";

interface KnownEntities {
  lightIds: ReadonlySet<string>;
  numberEntityIds: ReadonlySet<string>;
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
  const schema = buildScenePlanSchema({
    lightIds: new Set(knownLightIds),
    numberEntityIds: new Set(knownNumberEntityIds),
  });

  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new InvalidScenePlanError(parsed.error.issues.map(toScenePlanIssue));
  return parsed.data;
}

// --- Schema -------------------------------------------------------------

const nonEmptyString = z
  .string({ error: NON_EMPTY_STRING_MESSAGE })
  .refine(value => value.trim() !== "", { error: NON_EMPTY_STRING_MESSAGE });

function numberInRange(range: { min: number; max: number }): z.ZodNumber {
  const error = `must be a number between ${range.min} and ${range.max}`;
  return z.number({ error }).min(range.min, { error }).max(range.max, { error });
}

const colorChannel = z
  .number({ error: COLOR_MESSAGE })
  .min(COLOR_CHANNEL_RANGE.min, { error: COLOR_MESSAGE })
  .max(COLOR_CHANNEL_RANGE.max, { error: COLOR_MESSAGE });

const lightFieldsSchema = z.object({
  state: z.enum(["on", "off"], { error: 'must be "on" or "off"' }).optional(),
  brightness: numberInRange(BRIGHTNESS_RANGE).optional(),
  color: z.tuple([colorChannel, colorChannel, colorChannel], { error: COLOR_MESSAGE }).optional(),
  effect: nonEmptyString.optional(),
  // A value is a number entity's setting - on a light it means the model
  // mixed the two up, so reject it rather than silently dropping it.
  value: z.never({ error: "value is only valid for number.* entities" }).optional(),
});

// number entities carry only a value - a WiZ effect-speed knob, not a light.
const numberFieldsSchema = z.object({
  value: numberInRange(EFFECT_SPEED_RANGE),
});

// The entity id decides which of the two field schemas applies, so it is
// parsed first and the rest of the entry is kept for the second pass.
const settingEntrySchema = z.looseObject(
  { entity_id: nonEmptyString },
  { error: "must be an object" },
);

function buildScenePlanSchema(known: KnownEntities) {
  const lightSettingSchema = settingEntrySchema.transform((entry, ctx) => parseLightSetting(entry, known, ctx));

  return z.object(
    {
      name: nonEmptyString,
      description: nonEmptyString,
      // Only runs the duplicate check once every entry is otherwise valid -
      // Zod skips an array's refinements while its elements have issues.
      lights: z
        .array(lightSettingSchema, { error: LIGHTS_MESSAGE })
        .min(1, { error: LIGHTS_MESSAGE })
        .superRefine(rejectDuplicateEntities),
    },
    { error: "plan is not an object" },
  );
}

// --- Entry parsing ------------------------------------------------------

function parseLightSetting(
  entry: z.output<typeof settingEntrySchema>,
  known: KnownEntities,
  ctx: z.RefinementCtx,
): LightSetting {
  const entityId = entry.entity_id;

  const entityIdProblem = findEntityIdProblem(entityId, known);
  if (entityIdProblem) {
    ctx.addIssue({ code: "custom", path: ["entity_id"], message: entityIdProblem });
    return z.NEVER;
  }

  if (entityId.startsWith(NUMBER_DOMAIN_PREFIX)) {
    const fields = parseFields(numberFieldsSchema, entry, ctx);
    return fields ? { kind: "number", entity_id: entityId, value: fields.value } : z.NEVER;
  }

  const fields = parseFields(lightFieldsSchema, entry, ctx);
  if (!fields) return z.NEVER;
  const { state, brightness, color, effect } = fields;
  return {
    kind: "light",
    entity_id: entityId,
    ...(state !== undefined && { state }),
    ...(brightness !== undefined && { brightness }),
    ...(color !== undefined && { color }),
    ...(effect !== undefined && { effect }),
  };
}

function findEntityIdProblem(entityId: string, known: KnownEntities): string | undefined {
  if (entityId.startsWith(LIGHT_DOMAIN_PREFIX)) {
    return known.lightIds.has(entityId) ? undefined : `unknown light entity: "${entityId}"`;
  }
  if (entityId.startsWith(NUMBER_DOMAIN_PREFIX)) {
    const isKnownEffectSpeed = EFFECT_SPEED_ENTITY.test(entityId) && known.numberEntityIds.has(entityId);
    return isKnownEffectSpeed ? undefined : `unsupported number entity: "${entityId}"`;
  }
  return `unsupported domain: "${entityId}"`;
}

// Runs a field schema against the entry and re-reports its issues on the
// entry itself, so their paths stay relative to lights[i].
function parseFields<S extends z.ZodType>(schema: S, entry: unknown, ctx: z.RefinementCtx): z.output<S> | undefined {
  const parsed = schema.safeParse(entry);
  if (parsed.success) return parsed.data;

  for (const issue of parsed.error.issues) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
  return undefined;
}

// Two entries for the same entity would both fire through Promise.all in
// applyScene(), racing each other for the final state - reject rather than
// leave the outcome dependent on request ordering.
function rejectDuplicateEntities(lights: LightSetting[], ctx: z.RefinementCtx): void {
  const seenEntityIds = new Set<string>();
  for (const [index, light] of lights.entries()) {
    if (seenEntityIds.has(light.entity_id)) {
      ctx.addIssue({
        code: "custom",
        path: [index, "entity_id"],
        message: `duplicate entity_id: "${light.entity_id}" (also set by an earlier entry)`,
      });
    }
    seenEntityIds.add(light.entity_id);
  }
}

// --- Issue reporting ----------------------------------------------------

function toScenePlanIssue(issue: z.core.$ZodIssue): ScenePlanIssue {
  return { path: formatIssuePath(issue.path), message: issue.message };
}

// ["lights", 0, "entity_id"] -> "lights[0].entity_id"; the root is "$".
function formatIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) return "$";

  let formatted = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      formatted += `[${segment}]`;
    } else {
      formatted += formatted === "" ? String(segment) : `.${String(segment)}`;
    }
  }
  return formatted;
}
