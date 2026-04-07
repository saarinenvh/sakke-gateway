const searxngUrl = process.env.SEARXNG_URL ?? "http://searxng:8080";

export async function webSearch(query: string): Promise<string> {
  const url = `${searxngUrl}/search?q=${encodeURIComponent(query)}&format=json&language=en`;

  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (compatible; Sakke/1.0)",
    },
  });

  if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);

  const data = await res.json() as { results?: { title: string; content: string; url: string }[] };
  const results = data.results?.slice(0, 4) ?? [];

  if (results.length === 0) return "No results found.";

  return results
    .map(r => `${r.title}\n${r.content}\n${r.url}`)
    .join("\n\n");
}
