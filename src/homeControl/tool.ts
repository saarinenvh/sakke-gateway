import type { Tool } from "../tools/types.js";
import { dispatch } from "./dispatcher.js";
import type { Intent } from "./intent.js";
import { getState, callService } from "../integrations/homeAssistant/client.js";
import { loadEntities, getAreas, getScenes, getScripts } from "../integrations/homeAssistant/registry.js";

export const controlHomeAssistantTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "control_home_assistant",
      description: "Control smart home devices: lights, scenes, media, switches, routines. IMPORTANT: Always use the exact action values from the enum — never use HA service names like light.turn_on or switch.turn_on.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "The action to perform. Use scene_design when the user asks to design, create, or generate a lighting scene from a description.",
            enum: [
              "light_on", "light_off", "light_dim", "light_color",
              "scene_activate", "scene_create", "scene_design",
              "switch_on", "switch_off",
              "media_play", "media_pause", "media_stop", "media_volume",
            ],
          },
          area: { type: "string", description: "Room area id e.g. living_room" },
          device: { type: "string", description: "Specific entity_id" },
          scene: { type: "string", description: "Scene id for scene_activate" },
          scene_name: { type: "string", description: "Name for scene_create (saves current light state as a scene)" },
          scene_description: { type: "string", description: "REQUIRED for scene_design: describe the atmosphere or mood and the AI generates and applies a custom lighting scene. Use this when the user says 'design', 'create a scene for', 'make it look like', 'gaming den', etc." },
          brightness_pct: { type: "number", description: "Brightness percentage, 0-100, for light_dim. \"Dim the lights\" with no number given is about 30." },
          color: { type: "string", description: "Color name for light_color" },
          volume: { type: "number", description: "0-100 for media_volume" },
        },
        required: ["action"],
      },
    },
  },
  execute: args => dispatch({ ...args, raw: JSON.stringify(args) } as Intent),
};

export const getDeviceStateTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "get_device_state",
      description: "Get the current state and attributes of a Home Assistant entity. Call this BEFORE acting on a device if you are unsure of its current state. Also use when asked about what is on, what is playing, is something on/off, or any question about current device status.",
      parameters: {
        type: "object",
        properties: {
          entity_id: { type: "string", description: "The entity ID to query, e.g. remote.living_room_tv, media_player.bedroom_tv, light.ceiling" },
        },
        required: ["entity_id"],
      },
    },
  },
  execute: async args => {
    const state = await getState(args.entity_id as string);
    return JSON.stringify({ state: state.state, attributes: state.attributes });
  },
};

export const runRoutineTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "run_routine",
      description: "Run a user-defined routine (HA script). Use this for any named routine the user has created — e.g. 'good night', 'movie time', 'morning lights'. Check available routines in the system prompt.",
      parameters: {
        type: "object",
        properties: {
          script_id: { type: "string", description: "Script ID from the available routines list, e.g. good_night" },
        },
        required: ["script_id"],
      },
    },
  },
  execute: async args => {
    const scriptId = args.script_id as string;
    await callService("script", "turn_on", { entity_id: `script.${scriptId}` });
    return `Routine "${scriptId}" started.`;
  },
};

export const refreshHomeDataTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "refresh_home_data",
      description: "Reload the list of areas, lights, switches, scenes, and routines from Home Assistant. Call this when a scene, light, area, or routine the user mentions isn't in your known lists, or when explicitly asked to refresh, update, or reload your knowledge of the smart home (e.g. 'refresh your scenes', 'do you know about the new scene I made', 'update your info'). This data is only loaded at startup otherwise, so it can go stale when things change in Home Assistant.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  execute: async () => {
    await loadEntities();
    const names = (xs: { name: string }[]) => xs.map(x => x.name).join(", ") || "none";
    return `Reloaded home data.\nAreas: ${names(getAreas())}\nScenes: ${names(getScenes())}\nRoutines: ${names(getScripts())}`;
  },
};
