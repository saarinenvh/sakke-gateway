import { promises as fs, readFileSync } from "fs";
import { join, resolve } from "path";
import { config } from "../config.js";

export type PageResult =
  | { ok: true; content: string }
  | { ok: false; reason: "escapes-root" | "not-found"; path: string };

// The page name comes from the model, so it can't be trusted to stay inside
// the wiki - "../../etc/passwd" would have been read straight out of the
// mount. Resolve it and check where it actually landed rather than trying to
// spot bad input, which is the same reason saveNote below sanitises its
// filename.
export async function readPage(page: string): Promise<PageResult> {
  const path = resolve(config.wikiRoot, `${page}.md`);
  if (path !== config.wikiRoot && !path.startsWith(`${config.wikiRoot}/`)) {
    return { ok: false, reason: "escapes-root", path };
  }
  try {
    return { ok: true, content: await fs.readFile(path, "utf-8") };
  } catch {
    return { ok: false, reason: "not-found", path };
  }
}

export interface SavedNote {
  filename: string;
  /** False when an existing note was overwritten, in which case the index already links it. */
  isNew: boolean;
}

export async function saveNote(rawFilename: string, content: string): Promise<SavedNote> {
  const filename = rawFilename.replace(/[^a-z0-9_-]/gi, "_");
  const docsDir = `${config.wikiRoot}/sakke-knowledge`;
  const path = `${docsDir}/${filename}.md`;

  await fs.mkdir(docsDir, { recursive: true });
  const isNew = !await fs.access(path).then(() => true).catch(() => false);
  await fs.writeFile(path, content);
  if (isNew) await fs.appendFile(`${docsDir}/sakke-index.md`, `- [[sakke-knowledge/${filename}]]\n`);
  return { filename, isNew };
}

// Strips Obsidian's --- frontmatter block so it doesn't arrive as noise in a
// model's context. Left in the source files since it's useful to a human
// browsing the vault.
export function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  return end === -1 ? content : content.slice(end + 4).trimStart();
}

// Reads a doc from the mounted wiki, falling back to a bundled repo copy when
// no wiki is mounted (e.g. the dev machine) or the file doesn't exist there.
// filename is always a caller-chosen constant, not model input, so unlike
// readPage above there's no path-traversal surface to guard against.
export function readWikiDocWithFallback(
  wikiSubdir: string,
  filename: string,
  bundledDir: string,
  log: (source: string) => void,
): string {
  const wikiPath = join(config.wikiRoot, wikiSubdir, filename);
  try {
    const content = readFileSync(wikiPath, "utf-8");
    log(wikiPath);
    return stripFrontmatter(content);
  } catch {
    const bundledPath = join(bundledDir, filename);
    log(`${bundledPath} (bundled fallback - no wiki copy)`);
    return stripFrontmatter(readFileSync(bundledPath, "utf-8"));
  }
}
