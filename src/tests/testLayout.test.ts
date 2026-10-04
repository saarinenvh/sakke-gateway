import { describe, expect, it } from "vitest";
import { readdirSync } from "fs";
import { join, relative, sep } from "path";

// Every module keeps its tests in a tests/ subfolder (.agents/code-style.md,
// Folder structure), so a test next to the code is a layout mistake.
const SRC_DIR = join(__dirname, "..");

function findTestFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findTestFiles(path));
    else if (entry.name.endsWith(".test.ts")) found.push(relative(SRC_DIR, path));
  }
  return found;
}

describe("test layout", () => {
  it("keeps every test in a tests/ folder", () => {
    const misplaced = findTestFiles(SRC_DIR).filter(path => !path.split(sep).includes("tests"));
    expect(misplaced).toEqual([]);
  });
});
