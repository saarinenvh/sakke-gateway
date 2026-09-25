// Flat config (ESLint 9+). Independent of the project's own module system
// (tsconfig.json targets CommonJS) - .mjs makes this file ESM regardless, which
// is what ESLint's own docs assume for flat config examples.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 31 existing `any`s across 17 files as of 2026-09-25 (HA/Ollama/OpenAI
      // response shapes, test mocks, caught-error types) - enabling this now
      // would block lint adoption on a broad, unplanned typing pass. Off for
      // this first rollout; worth revisiting as its own deliberate cleanup.
      "@typescript-eslint/no-explicit-any": "off",

      // A prefixed underscore is this codebase's existing convention for an
      // intentionally-unused parameter (see tests' fixture callbacks).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // `catch {}` on a stream write is a deliberate, established pattern here
      // (display/displayState.ts, display/route.ts) - the client may have
      // already disconnected, and that's not worth a log line for every SSE
      // write. This is exactly what allowEmptyCatch exists for.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
