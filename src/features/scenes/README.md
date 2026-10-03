# Scenes

Designs lighting scenes from a description with OpenAI
(`config.openai.lightingModel`), validates the plan against the lights and
number entities Home Assistant has, and applies it: every light off, then the
plan's settings. An invalid plan touches no device. It can also save the
lights' current state as a Home Assistant scene.

## Entry points

| Route | Does |
| --- | --- |
| `POST /scene` | designs a scene from `{ description }`, and applies it when `apply` is true |
| `POST /scene/save` | saves the current state of `entity_ids` (default: every light) as a scene called `name` |

| Export | Called by |
| --- | --- |
| `designScene`, `applyScene`, `saveCurrentStateAsScene` | `tools/homeControl/dispatcher.ts` and `route.ts` |

## Data

None in the gateway. Saved scenes are stored in Home Assistant. The lamp
descriptions are read from the wiki (`lighting-designer/`) when it has them,
else from the bundled copies in `prompts/`.

## Files

| File | Does |
| --- | --- |
| `scenes.ts` | design, apply and save |
| `sceneValidator.ts` | `validateScenePlan`: every problem in a plan, before anything is touched |
| `route.ts` | the two routes |
| `schema.ts` | the two request bodies |
| `prompts/lighting_designer_prompt.md` | the designer briefing and output shape |
| `prompts/lighting_context.md`, `prompts/lighting_layout.md` | bundled lamp and room descriptions, used when the wiki has none |
