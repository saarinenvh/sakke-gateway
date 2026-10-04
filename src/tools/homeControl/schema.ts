import { z } from "zod";
import { modelNumber } from "../parameters.js";

// Model → gateway: the arguments of a control_home_assistant tool call.

export const controlHomeAssistantArgsExample = {
  action: "light_dim",
  area: "living_room",
  device: "light.ceiling",
  scene: "evening",
  scene_name: "Movie night",
  scene_description: "A warm, dim campfire glow",
  brightness_pct: 30,
  color: "warm white",
  volume: 40,
};

export const controlHomeAssistantArgsSchema = z.object({
  action: z
    .enum([
      "light_on", "light_off", "light_dim", "light_color",
      "scene_activate", "scene_create", "scene_design",
      "switch_on", "switch_off",
      "media_play", "media_pause", "media_stop", "media_volume",
    ])
    .describe("The action to perform. Use scene_design when the user asks to design, create, or generate a lighting scene from a description."),
  area: z.string().describe("Room area id e.g. living_room").optional(),
  device: z.string().describe("Specific entity_id").optional(),
  scene: z.string().describe("Scene id for scene_activate").optional(),
  scene_name: z.string().describe("Name for scene_create (saves current light state as a scene)").optional(),
  scene_description: z
    .string()
    .describe("REQUIRED for scene_design: describe the atmosphere or mood and the AI generates and applies a custom lighting scene. Use this when the user says 'design', 'create a scene for', 'make it look like', 'gaming den', etc.")
    .optional(),
  brightness_pct: modelNumber
    .describe("Brightness percentage, 0-100, for light_dim. \"Dim the lights\" with no number given is about 30.")
    .optional(),
  color: z.string().describe("Color name for light_color").optional(),
  volume: modelNumber.describe("0-100 for media_volume").optional(),
});

export type ControlHomeAssistantArgs = z.output<typeof controlHomeAssistantArgsSchema>;

// Designing a scene is a long OpenAI round trip, and saving the current lights
// as a scene at some later time isn't something anyone means; everything else
// can run at a set time.
const UNSCHEDULABLE_ACTIONS: ReadonlySet<ControlHomeAssistantArgs["action"]> = new Set(["scene_design", "scene_create"]);

export function isSchedulableControl(args: Record<string, unknown>): boolean {
  const parsed = controlHomeAssistantArgsSchema.safeParse(args);
  return parsed.success && !UNSCHEDULABLE_ACTIONS.has(parsed.data.action);
}

// Model → gateway: the arguments of a get_device_state tool call.

export const getDeviceStateArgsExample = { entity_id: "media_player.bedroom_tv" };

export const getDeviceStateArgsSchema = z.object({
  entity_id: z.string().describe("The entity ID to query, e.g. remote.living_room_tv, media_player.bedroom_tv, light.ceiling"),
});

// Model → gateway: the arguments of a run_routine tool call.

export const runRoutineArgsExample = { script_id: "good_night" };

export const runRoutineArgsSchema = z.object({
  script_id: z.string().describe("Script ID from the available routines list, e.g. good_night"),
});

// Model → gateway: the arguments of a refresh_home_data tool call.

export const refreshHomeDataArgsExample = {};

export const refreshHomeDataArgsSchema = z.object({});
