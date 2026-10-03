import { config } from "../../config.js";
import { parseJsonResponse } from "../../util/validation.js";
import { searchResponseSchema, type SearchResult } from "./schema.js";

const SEARCH_TIMEOUT_MS = 8000;

export async function search(query: string): Promise<SearchResult[]> {
  const url = `${config.search.searxngUrl}/search?q=${encodeURIComponent(query)}&format=json&language=en`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
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
  return data.results;
}
