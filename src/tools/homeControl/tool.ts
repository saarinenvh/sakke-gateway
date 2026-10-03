import type { Tool } from "../types.js";
import { dispatch } from "./dispatcher.js";
import { getState, callService } from "../../integrations/homeAssistant/client.js";
import { loadEntities, getAreas, getScenes, getScripts } from "../../integrations/homeAssistant/registry.js";
import { toolParameters, parseToolArgs } from "../parameters.js";
import { controlHomeAssistantArgsSchema, getDeviceStateArgsSchema, refreshHomeDataArgsSchema, runRoutineArgsSchema } from "./schema.js";

export const controlHomeAssistantTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "control_home_assistant",
      description: "Control smart home devices: lights, scenes, media, switches, routines. IMPORTANT: Always use the exact action values from the enum — never use HA service names like light.turn_on or switch.turn_on.",
      parameters: toolParameters(controlHomeAssistantArgsSchema),
    },
  },
  repeatable: () => false,
  execute: args => dispatch({
    ...parseToolArgs(controlHomeAssistantArgsSchema, args, "control_home_assistant"),
    raw: JSON.stringify(args),
  }),
};

export const getDeviceStateTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "get_device_state",
      description: "Get the current state and attributes of a Home Assistant entity. Call this BEFORE acting on a device if you are unsure of its current state. Also use when asked about what is on, what is playing, is something on/off, or any question about current device status.",
      parameters: toolParameters(getDeviceStateArgsSchema),
    },
  },
  repeatable: () => true,
  execute: async args => {
    const { entity_id } = parseToolArgs(getDeviceStateArgsSchema, args, "get_device_state");
    const state = await getState(entity_id);
    return JSON.stringify({ state: state.state, attributes: state.attributes });
  },
};

export const runRoutineTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "run_routine",
      description: "Run a user-defined routine (HA script). Use this for any named routine the user has created — e.g. 'good night', 'movie time', 'morning lights'. Check available routines in the system prompt.",
      parameters: toolParameters(runRoutineArgsSchema),
    },
  },
  repeatable: () => false,
  execute: async args => {
    const { script_id } = parseToolArgs(runRoutineArgsSchema, args, "run_routine");
    await callService("script", "turn_on", { entity_id: `script.${script_id}` });
    return `Routine "${script_id}" started.`;
  },
};

export const refreshHomeDataTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "refresh_home_data",
      description: "Reload the list of areas, lights, switches, scenes, and routines from Home Assistant. Call this when a scene, light, area, or routine the user mentions isn't in your known lists, or when explicitly asked to refresh, update, or reload your knowledge of the smart home (e.g. 'refresh your scenes', 'do you know about the new scene I made', 'update your info'). This data is only loaded at startup otherwise, so it can go stale when things change in Home Assistant.",
      parameters: toolParameters(refreshHomeDataArgsSchema),
    },
  },
  repeatable: () => true,
  execute: async () => {
    await loadEntities();
    const names = (xs: { name: string }[]) => xs.map(x => x.name).join(", ") || "none";
    return `Reloaded home data.\nAreas: ${names(getAreas())}\nScenes: ${names(getScenes())}\nRoutines: ${names(getScripts())}`;
  },
};
