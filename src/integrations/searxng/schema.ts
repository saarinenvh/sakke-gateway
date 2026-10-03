import { z } from "zod";

// SearXNG → gateway, GET /search?format=json (searxng/client.ts).

export const searchResponseExample = {
  query: "Helsinki disc golf courses", // ignored
  number_of_results: 0, // ignored
  results: [
    {
      url: "https://example.com/disc-golf/helsinki",
      title: "Disc golf courses in Helsinki",
      content: "A list of the disc golf courses around Helsinki, with maps and layouts.", // missing on some results
      engine: "duckduckgo", // ignored
      template: "default.html", // ignored
      parsed_url: ["https", "example.com", "/disc-golf/helsinki", "", "", ""], // ignored
      img_src: "", // ignored
      thumbnail: "", // ignored
      priority: "", // ignored
      engines: ["duckduckgo", "brave"], // ignored
      positions: [1, 2], // ignored
      score: 3, // ignored
      category: "general", // ignored
      publishedDate: null, // ignored
    },
  ],
  answers: [], // ignored
  corrections: [], // ignored
  infoboxes: [], // ignored
  suggestions: ["disc golf espoo"], // ignored
  unresponsive_engines: [], // ignored
};

// An empty results array is a valid "nothing found"; a missing one is not.
export const searchResponseSchema = z.object({
  results: z.array(z.object({ title: z.string(), content: z.string().optional(), url: z.string() })),
});

export type SearchResult = z.output<typeof searchResponseSchema>["results"][number];
