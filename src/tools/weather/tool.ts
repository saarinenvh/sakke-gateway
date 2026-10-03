import type { Tool } from "../types.js";
import { toolParameters } from "../parameters.js";
import { getWeatherArgsSchema } from "./schema.js";
import { getWeather } from "../../integrations/openMeteo/weather.js";

export const weatherTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather and forecast for the user's location (Espoo, Finland)",
      parameters: toolParameters(getWeatherArgsSchema),
    },
  },
  repeatable: () => true,
  execute: () => getWeather(),
};
