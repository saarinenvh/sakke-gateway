import { readFileSync } from "fs";
import { join } from "path";
import { config } from "../../config.js";
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

type LayoutSource = "wiki" | "no-wiki-page" | "no-sections";

// A fallback warns on every read, so a missing page can't hide behind one old
// log line. Reading from the wiki is the normal case, logged only when it
// starts, since the layout is read on every conversation turn.
let lastSource: LayoutSource | undefined;

export function loadStoreLayout(): StoreSection[] {
  const wikiPath = join(config.wikiRoot, WIKI_DIR, LAYOUT_FILE);
  let readFrom = "";
  const layout = parseStoreLayout(readWikiDocWithFallback(WIKI_DIR, LAYOUT_FILE, BUNDLED_DIR, path => (readFrom = path)));

  if (readFrom !== wikiPath) {
    reportSource("no-wiki-page", wikiPath);
    return layout;
  }
  if (layout.length > 0) {
    reportSource("wiki", wikiPath);
    return layout;
  }

  reportSource("no-sections", wikiPath);
  return parseStoreLayout(stripFrontmatter(readFileSync(join(BUNDLED_DIR, LAYOUT_FILE), "utf-8")));
}

function reportSource(source: LayoutSource, wikiPath: string): void {
  const previous = lastSource;
  lastSource = source;

  if (source === "wiki") {
    if (previous !== "wiki") moduleLog().info({ wikiPath }, "Store layout read from the wiki");
  } else if (source === "no-wiki-page") moduleLog().warn({ wikiPath }, "Store layout not in the wiki, using the bundled copy");
  else moduleLog().warn({ wikiPath }, "Store layout in the wiki has no sections, using the bundled copy");
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
