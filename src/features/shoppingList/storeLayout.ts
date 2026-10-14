import { readFileSync } from "fs";
import { join } from "path";
import { moduleLog } from "../../logger.js";
import { readWikiDocWithFallback, stripFrontmatter } from "../wiki/wiki.js";

// The store order lives in the wiki, so changing it is an Obsidian edit rather
// than a deploy. Read on every use, so an edit applies at once.
const WIKI_DIR = "home/context";
const LAYOUT_FILE = "store_layout.md";
const BUNDLED_DIR = __dirname;

export interface StoreSection {
  section: string;
  // Lower-case, matched as substrings of an item's name.
  keywords: string[];
}

export function loadStoreLayout(): StoreSection[] {
  let source = "";
  const layout = parseStoreLayout(readWikiDocWithFallback(WIKI_DIR, LAYOUT_FILE, BUNDLED_DIR, path => (source = path)));
  if (layout.length > 0) return layout;

  moduleLog().warn({ source }, "Store layout has no sections, using the bundled copy");
  return parseStoreLayout(stripFrontmatter(readFileSync(join(BUNDLED_DIR, LAYOUT_FILE), "utf-8")));
}

// Each "## " heading starts a section, in store order; the comma-separated
// words under it are its keywords. Text before the first heading is ignored.
// Expects the frontmatter already stripped.
export function parseStoreLayout(markdown: string): StoreSection[] {
  const layout: StoreSection[] = [];

  for (const line of markdown.split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      layout.push({ section: heading[1], keywords: [] });
      continue;
    }

    const current = layout.at(-1);
    if (!current) continue;

    const keywords = line.split(",").map(keyword => keyword.trim().toLowerCase()).filter(Boolean);
    current.keywords.push(...keywords);
  }

  return layout;
}
