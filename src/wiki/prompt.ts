import { promises as fs } from "fs";
import { join } from "path";
import { config } from "../config.js";

export async function wikiPrompt(): Promise<string> {
  const rules = `Knowledge: when the user shares something personal — a preference, a habit, a fact about their life, a hobby detail — save it with create_knowledge, silently, alongside your normal reply. Do the same for a web search result genuinely worth remembering. Format a note as "## Title" followed by a blank line and a short description, never a bare title.`;

  try {
    const index = await fs.readFile(join(config.wikiRoot, "index.md"), "utf-8");
    return `${rules}

Knowledge base — call get_context(page) to load a page when relevant:
${index}`;
  } catch {
    // No wiki mounted - the tools still exist, there's just no index to offer.
    return rules;
  }
}
