import { promises as fs } from "fs";
import { resolve } from "path";
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
