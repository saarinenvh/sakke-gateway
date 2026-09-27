import { describe, it, expect } from "vitest";
import { stripFrontmatter } from "./wiki.js";

// The lighting documents live in the Obsidian vault and carry frontmatter for
// the vault's own bookkeeping. The whole document is sent to GPT-4o, so that
// metadata would otherwise arrive as a few hundred bytes of instruction-shaped
// noise at the top of the lighting brief.

describe("stripFrontmatter", () => {
  it("removes a leading frontmatter block", () => {
    const doc = [
      "---",
      "id: lighting-designer.context",
      "type: designer-input",
      "indexed: false",
      "---",
      "",
      "# Lighting System Context",
      "",
      "## Overview",
    ].join("\n");
    expect(stripFrontmatter(doc)).toBe("# Lighting System Context\n\n## Overview");
  });

  it("leaves a document without frontmatter alone", () => {
    // The bundled fallback copies have none.
    const doc = "# Lighting System Context\n\n## Overview\n";
    expect(stripFrontmatter(doc)).toBe(doc);
  });

  it("does not mistake a horizontal rule for frontmatter", () => {
    // These documents use --- as a section divider throughout, so removing the
    // first one found would eat the opening section.
    const doc = "# Title\n\n---\n\n## Overview";
    expect(stripFrontmatter(doc)).toBe(doc);
  });

  it("keeps horizontal rules that follow real frontmatter", () => {
    const doc = "---\nid: x\n---\n\n# Title\n\n---\n\n## Overview";
    const result = stripFrontmatter(doc);
    expect(result).toBe("# Title\n\n---\n\n## Overview");
    expect(result).toContain("---");
  });

  it("leaves an unterminated frontmatter block intact rather than eating the file", () => {
    // A half-written or truncated block should degrade to "send it as-is",
    // not to "send nothing".
    const doc = "---\nid: x\n\n# Title";
    expect(stripFrontmatter(doc)).toBe(doc);
  });

  it("handles an empty document", () => {
    expect(stripFrontmatter("")).toBe("");
  });
});
