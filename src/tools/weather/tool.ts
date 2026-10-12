import type { Tool } from "../types.js";
import { toolParameters } from "../parameters.js";
import { getWeatherArgsSchema } from "./schema.js";
import { getWeather } from "../../integrations/openMeteo/weather.js";

export const weatherTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the weather for the user's location (Espoo, Finland): the current conditions, today's forecast for the whole day, and the next 6 hours from now",
      parameters: toolParameters(getWeatherArgsSchema),
    },
  },
  repeatable: () => true,
  execute: () => getWeather(),
};
