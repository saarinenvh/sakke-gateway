import { search } from "../../integrations/searxng/client.js";

const MAX_RESULTS = 4;

export async function webSearch(query: string): Promise<string> {
  const results = (await search(query)).slice(0, MAX_RESULTS);

  if (results.length === 0) return "No results found.";

  return results
    .map(r => `${r.title}\n${r.content ?? ""}\n${r.url}`)
    .join("\n\n");
}
