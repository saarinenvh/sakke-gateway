# Wiki

Reads and writes the Obsidian vault mounted at `config.wikiRoot`. A page asked
for by the model is resolved inside the vault or refused; a saved note goes to
`sakke-knowledge/` and is linked from `sakke-knowledge/sakke-index.md` the
first time. Docs other features read lose their frontmatter, and fall back to
a bundled copy when the vault has none.

## Entry points

| Export | Called by |
| --- | --- |
| `readPage(page)`, `saveNote(filename, content)` | `tools/wiki/tool.ts` (`get_context`, `create_knowledge`) |
| `readWikiDocWithFallback(...)` | `features/scenes/scenes.ts`, for the lighting documents |
| `stripFrontmatter(content)` | `readWikiDocWithFallback` |

## Data

None in the gateway database. The vault is the store; this feature writes only
under `sakke-knowledge/`.

## Files

| File | Does |
| --- | --- |
| `wiki.ts` | page reads, note saves, frontmatter stripping, the bundled fallback |
