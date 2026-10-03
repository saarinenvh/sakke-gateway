import type { Tool } from "../types.js";
import { toolParameters, parseToolArgs } from "../parameters.js";
import { webSearchArgsSchema } from "./schema.js";
import { webSearch } from "./search.js";

export const webSearchTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current information, facts, news",
      parameters: toolParameters(webSearchArgsSchema),
    },
  },
  repeatable: () => true,
  execute: args => webSearch(parseToolArgs(webSearchArgsSchema, args, "web_search").query),
};
