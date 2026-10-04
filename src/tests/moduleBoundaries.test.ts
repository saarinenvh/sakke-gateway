import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { dirname, join, relative, resolve, sep } from "path";

// The rules in docs/architecture/tools.md: a tool folder is only the model's
// interface, and only integrations talk HTTP.
const SRC_DIR = join(__dirname, "..");
const TOOLS_DIR = join(SRC_DIR, "tools");
const INTEGRATIONS_DIR = join(SRC_DIR, "integrations");
const AGENT_DIR = join(SRC_DIR, "agent");
// Below the agent and the tools: index.ts wires in what they need from above.
const LOWER_LAYERS = [join(SRC_DIR, "features"), join(SRC_DIR, "inference")];
// The tool definition type is shared by every layer that talks to the model.
const SHARED_TOOL_TYPES = join(TOOLS_DIR, "types");

// What the rest of the gateway may use from tools/: the registry and the
// shared tool types, and per tool its definition and its system prompt part.
const SHARED_TOOL_MODULES = new Set(["registry", "types", "parameters"]);
const PUBLIC_TOOL_FILES = new Set(["tool", "prompt"]);

interface SourceFile {
  path: string;
  text: string;
}

function readSourceFiles(dir: string): SourceFile[] {
  const files: SourceFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "tests") files.push(...readSourceFiles(path));
    } else if (entry.name.endsWith(".ts")) {
      files.push({ path, text: readFileSync(path, "utf-8") });
    }
  }
  return files;
}

function relativeImports(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?:\bfrom|\bimport\s*\(|^\s*import)\s*["'](\.{1,2}\/[^"']+)["']/gm)) found.push(match[1]);
  return found;
}

function isInside(path: string, dir: string): boolean {
  return path.startsWith(dir + sep);
}

// "tools/<name>/<file>" for a module inside a tool folder, else null.
function toolInternal(modulePath: string): string | null {
  const parts = relative(TOOLS_DIR, modulePath).split(sep);
  if (parts.length === 1) return SHARED_TOOL_MODULES.has(parts[0]) ? null : parts[0];
  const file = parts[parts.length - 1];
  return parts.length === 2 && PUBLIC_TOOL_FILES.has(file) ? null : parts.join("/");
}

const sources = readSourceFiles(SRC_DIR);

describe("module boundaries", () => {
  it("talks HTTP only from integrations/", () => {
    const fetching = sources
      .filter(file => !isInside(file.path, INTEGRATIONS_DIR) && /\bfetch\(/.test(file.text))
      .map(file => relative(SRC_DIR, file.path));
    expect(fetching).toEqual([]);
  });

  it("uses only a tool's definition and prompt from outside tools/", () => {
    const violations: string[] = [];
    for (const file of sources) {
      if (isInside(file.path, TOOLS_DIR)) continue;
      for (const specifier of relativeImports(file.text)) {
        const target = resolve(dirname(file.path), specifier).replace(/\.js$/, "");
        if (!isInside(target, TOOLS_DIR)) continue;
        const internal = toolInternal(target);
        if (internal !== null) violations.push(`${relative(SRC_DIR, file.path)} → tools/${internal}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps features and inference below the agent and the tools", () => {
    const violations: string[] = [];
    for (const file of sources) {
      if (!LOWER_LAYERS.some(dir => isInside(file.path, dir))) continue;
      for (const specifier of relativeImports(file.text)) {
        const target = resolve(dirname(file.path), specifier).replace(/\.js$/, "");
        const upward = isInside(target, AGENT_DIR) || (isInside(target, TOOLS_DIR) && target !== SHARED_TOOL_TYPES);
        if (upward) violations.push(`${relative(SRC_DIR, file.path)} → ${relative(SRC_DIR, target)}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
