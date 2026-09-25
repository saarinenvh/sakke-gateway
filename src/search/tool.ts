import type { Tool } from "../tools/types.js";
import { webSearch } from "./webSearch.js";

export const webSearchTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current information, facts, news",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
  execute: args => webSearch(args.query as string),
};
