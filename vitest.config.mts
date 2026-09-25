import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
// .mts, not .ts: this package has no "type": "module", so Vite loads a .ts
// config as CommonJS and warns that its ESM syntax is unsupported by the
// config loader that becomes the default in a future major.
