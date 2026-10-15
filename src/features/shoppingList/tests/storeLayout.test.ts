import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { reloadConfig } from "../../../config.js";
import { setModuleLogger } from "../../../logger.js";
import { categorizeItem } from "../policy.js";
import { loadStoreLayout, parseStoreLayout } from "../storeLayout.js";

describe("parseStoreLayout", () => {
  it("reads sections in heading order with their comma-separated keywords, lower-cased", () => {
    const markdown = [
      "Walking order through the store.",
      "",
      "## Vegetables",
      "Apple, banana,  omena",
      "tomaatti",
      "",
      "## Dairy & Eggs",
      "milk, maito,",
    ].join("\n");

    expect(parseStoreLayout(markdown)).toEqual([
      { section: "Vegetables", keywords: ["apple", "banana", "omena", "tomaatti"] },
      { section: "Dairy & Eggs", keywords: ["milk", "maito"] },
    ]);
  });

  it("keeps a section without keywords, and ignores a page title", () => {
    expect(parseStoreLayout("# Store layout\n\n## Bakery\n")).toEqual([{ section: "Bakery", keywords: [] }]);
  });

  it("finds no sections in a page without ## headings", () => {
    expect(parseStoreLayout("apple, milk\n")).toEqual([]);
  });
});

describe("loadStoreLayout", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = mkdtempSync(join(tmpdir(), "wiki-"));
    process.env.WIKI_ROOT = wikiRoot;
    reloadConfig();
  });

  afterEach(() => {
    rmSync(wikiRoot, { recursive: true, force: true });
    delete process.env.WIKI_ROOT;
    reloadConfig();
  });

  function writeWikiLayout(markdown: string): void {
    mkdirSync(join(wikiRoot, "home/context"), { recursive: true });
    writeFileSync(join(wikiRoot, "home/context/store_layout.md"), markdown);
  }

  it("reads home/context/store_layout.md from the wiki", () => {
    writeWikiLayout("---\nid: home.context.store_layout\n---\n## Maito\nmaito\n## Leipä\nleipä\n");

    expect(loadStoreLayout().map(s => s.section)).toEqual(["Maito", "Leipä"]);
  });

  it("uses the bundled copy when the wiki has no layout", () => {
    const layout = loadStoreLayout();

    expect(layout[0].section).toBe("Electronics & Household");
    expect(layout[categorizeItem("milk", layout)].section).toBe("Dairy & Eggs");
  });

  it("uses the bundled copy when the wiki page has no sections", () => {
    writeWikiLayout("apple, milk\n");

    expect(loadStoreLayout()[0].section).toBe("Electronics & Household");
  });

  it("warns on every fallback, and logs reading from the wiki only when it starts", () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    setModuleLogger(log as unknown as FastifyBaseLogger);
    const wikiPath = join(wikiRoot, "home/context/store_layout.md");
    const logged = () => [...log.info.mock.calls, ...log.warn.mock.calls].map(call => call[1]);

    try {
      writeWikiLayout("## Maito\nmaito\n");
      loadStoreLayout();
      log.info.mockClear();

      rmSync(wikiPath);
      loadStoreLayout();
      loadStoreLayout();
      expect(log.warn).toHaveBeenCalledTimes(2);
      expect(log.warn).toHaveBeenLastCalledWith({ wikiPath }, "Store layout not in the wiki, using the bundled copy");

      writeWikiLayout("apple, milk\n");
      loadStoreLayout();
      loadStoreLayout();
      expect(log.warn).toHaveBeenCalledTimes(4);
      expect(log.warn).toHaveBeenLastCalledWith({ wikiPath }, "Store layout in the wiki has no sections, using the bundled copy");

      writeWikiLayout("## Maito\nmaito\n");
      loadStoreLayout();
      loadStoreLayout();
      expect(log.info).toHaveBeenCalledExactlyOnceWith({ wikiPath }, "Store layout read from the wiki");

      expect(logged()).toHaveLength(5);
    } finally {
      setModuleLogger(console as unknown as FastifyBaseLogger);
    }
  });
});
