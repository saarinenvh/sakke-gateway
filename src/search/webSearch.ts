import { z } from "zod";
import { config } from "../config.js";
import { parseJsonResponse } from "../util/validation.js";

const MAX_RESULTS = 4;

// An empty results array is a valid "nothing found"; a missing one is not.
const searchResponseSchema = z.object({
  results: z.array(z.object({ title: z.string(), content: z.string().optional(), url: z.string() })),
});

export async function webSearch(query: string): Promise<string> {
  const url = `${config.search.searxngUrl}/search?q=${encodeURIComponent(query)}&format=json&language=en`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: {
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (compatible; Sakke/1.0)",
      "X-Forwarded-For": "127.0.0.1",
      "X-Real-IP": "127.0.0.1",
    },
  });

  if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);

  const data = await parseJsonResponse(res, searchResponseSchema, "SearXNG search");
  const results = data.results.slice(0, MAX_RESULTS);

  if (results.length === 0) return "No results found.";

  return results
    .map(r => `${r.title}\n${r.content ?? ""}\n${r.url}`)
    .join("\n\n");
}
