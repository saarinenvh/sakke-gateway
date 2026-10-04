import { z } from "zod";

// Model → gateway: the arguments of a web_search tool call.

export const webSearchArgsExample = { query: "Helsinki disc golf courses" };

export const webSearchArgsSchema = z.object({
  query: z.string(),
});
