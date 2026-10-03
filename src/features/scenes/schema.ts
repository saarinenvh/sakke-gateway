import { z } from "zod";

// Any HTTP client → gateway, POST /scene and POST /scene/save. Nothing in
// sakke-workspace calls these; they are run by hand.

export const sceneRequestExample = {
  description: "warm and dim for a movie",
  apply: true, // false when missing: only design the plan
};

export const sceneRequestSchema = z.object({
  description: z.string().min(1),
  apply: z.boolean().optional(),
});

export const saveSceneRequestExample = {
  name: "Movie night",
  entity_ids: ["light.living_room_ceiling", "light.sofa_lamp"], // every light when missing
};

export const saveSceneRequestSchema = z.object({
  name: z.string().min(1),
  entity_ids: z.array(z.string()).optional(),
});

// HA → gateway, the attributes of a light in GET /api/states, read when the
// current light state is saved as a scene.

export const lightAttributesExample = {
  supported_color_modes: ["color_temp", "rgb"], // ignored
  color_mode: "color_temp",
  brightness: 128,
  color_temp_kelvin: 2700,
  color_temp: 370,
  min_color_temp_kelvin: 2202, // ignored
  max_color_temp_kelvin: 6535, // ignored
  min_mireds: 153, // ignored
  max_mireds: 454, // ignored
  hs_color: [30.5, 60.2],
  rgb_color: [255, 167, 87],
  xy_color: [0.526, 0.387],
  effect_list: ["None", "Fireplace", "Ocean"], // ignored
  effect: "None",
  friendly_name: "Living room ceiling", // ignored
  supported_features: 44, // ignored
};

// HA reports null, not a missing key, for the attributes of a light that is
// off. color_mode stays a plain string: HA has more modes (onoff, white,
// unknown) than saveCurrentStateAsScene handles, and those fall to its default.
export const lightAttributesSchema = z.object({
  brightness: z.number().nullish(),
  color_mode: z.string().nullish(),
  color_temp_kelvin: z.number().nullish(),
  color_temp: z.number().nullish(),
  rgb_color: z.tuple([z.number(), z.number(), z.number()]).nullish(),
  hs_color: z.tuple([z.number(), z.number()]).nullish(),
  xy_color: z.tuple([z.number(), z.number()]).nullish(),
  effect: z.string().nullish(),
});
