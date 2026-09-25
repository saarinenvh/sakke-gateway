import type { Tool } from "../tools/types.js";
import { getWeather } from "./weather.js";

export const weatherTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather and forecast for the user's location (Espoo, Finland)",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  execute: () => getWeather(),
};
