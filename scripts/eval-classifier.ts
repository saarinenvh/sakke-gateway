// Dev tool, not shipped app code (excluded from tsconfig.build.json the same
// way *.test.ts is - see tsconfig.build.json's comment). Compares candidate
// classifier models on both accuracy and latency against the real
// classifyFollowUp function, so a smaller model can be evaluated before it's
// trusted in production - this classifier has previously shipped real
// misclassification bugs, so "faster" alone isn't enough evidence to swap it.
//
// Usage:
//   npm run eval:classifier -- --model=qwen2.5:1.5b
//   npm run eval:classifier -- --model=qwen2.5:1.5b --baseUrl=http://100.90.103.31:11434
//
// Requires a real, reachable Ollama instance with the given model already
// pulled - this hits the network for real, unlike the rest of this repo's
// fully-hermetic tests, which is why it's a script rather than a vitest case.
//
// Run via tsc + node, not ts-node: this codebase's internal imports use a
// `.js` extension pointing at sibling `.ts` files (e.g. `./continuationCheck.js`).
// tsc itself resolves that fine, but ts-node's CJS runtime hook does not - it
// asks Node to require() a literal `./continuationCheck.js` that never
// exists, failing with MODULE_NOT_FOUND (confirmed pre-existing and
// repo-wide: `npm run dev`, i.e. plain `ts-node src/index.ts`, fails the
// same way). Compiling first sidesteps this entirely, the same way the real
// app actually runs (`npm run build && npm start`, never ts-node).
import "dotenv/config";
import { classifyFollowUp, type FollowUpVerdict } from "../src/agent/continuationCheck.js";
import { reloadConfig } from "../src/config.js";

interface ClassifierCase {
  // Where this case came from, so a failing case can be traced back to real
  // evidence rather than an arbitrary guess at what the model should do.
  source: string;
  lastUserMessage: string;
  lastAssistantMessage: string;
  newUtterance: string;
  expected: FollowUpVerdict;
}

// [source, lastUserMessage, lastAssistantMessage, newUtterance, expected] -
// a tuple table rather than repeated object literals, since the identical
// five-key shape repeated per case is exactly what a copy-paste detector
// flags as duplication even though only the values differ.
type ClassifierCaseRow = readonly [string, string, string, string, FollowUpVerdict];

const CASE_ROWS: ClassifierCaseRow[] = [
  ["live log, 2026-09-28 (sakke-gateway)", "What's the time?", "It's 21:39, Monday, 28 September 2026.", "Do I have any tasks for today?", "new_request"],
  ["live log, 2026-09-28 (sakke-gateway)", "Do I have any tasks for today?", "You have one task today: water the plants.", "I already bothered them.", "continuation"],
  ["live log, 2026-09-29 (sakke-gateway)", "What's the title?", "I don't know what title you're referring to. Could you clarify?", "I said, what's the time?", "new_request"],
  ["pending_tasks.md: generic open-ended reply must not force continuation by default", "Play some metal.", "Still here... what can I do for you?", "Could you light the campfire?", "new_request"],
  ["representative: direct pick from a just-presented option list", "Play the Discover Weekly playlist.", "Found: 1. Discover Weekly, 2. Metal, 3. Chill. Which one?", "The first one.", "continuation"],
  ["representative: same-topic follow-up referencing the prior subject", "Play something by Wintersun.", "Playing Wintersun's Time I.", "What other albums does that artist have?", "continuation"],
  ["representative: background chatter not directed at the assistant", "What's the weather tomorrow?", "Sunny, high of 18 degrees.", "yeah I know right, so annoying", "noise"],
  ["representative: incomplete fragment", "Turn off the living room lights.", "Living room lights are off.", "and then the", "noise"],
];

const CASES: ClassifierCase[] = CASE_ROWS.map(
  ([source, lastUserMessage, lastAssistantMessage, newUtterance, expected]) => ({
    source,
    lastUserMessage,
    lastAssistantMessage,
    newUtterance,
    expected,
  }),
);

function parseArgs(argv: string[]): { model: string; baseUrl: string } {
  const flags = new Map(
    argv
      .filter(arg => arg.startsWith("--"))
      .map(arg => {
        const [key, value] = arg.slice(2).split("=");
        return [key, value ?? ""];
      }),
  );

  const model = flags.get("model") || process.env.OLLAMA_CLASSIFIER_MODEL;
  if (!model) {
    throw new Error(
      "No model given. Pass --model=<name> or set OLLAMA_CLASSIFIER_MODEL.\n" +
      "Example: npm run eval:classifier -- --model=qwen2.5:1.5b",
    );
  }

  // config.ts defaults to host.docker.internal, which only resolves inside
  // the gateway's own container - this script runs on the host instead.
  const baseUrl = flags.get("baseUrl") || process.env.OLLAMA_CLASSIFIER_BASE_URL || "http://localhost:11434";

  return { model, baseUrl };
}

// Matches the fake FastifyBaseLogger used in tests/integration/agentLoop.test.ts,
// but prints instead of discarding - useful to watch each call's own latency
// live while a run is in progress, alongside the summary table at the end.
function createLogger() {
  const log: any = {
    info: (obj: Record<string, unknown>, msg: string) => console.log(`  [info] ${msg}`, obj),
    warn: (obj: Record<string, unknown>, msg: string) => console.warn(`  [warn] ${msg}`, obj),
    error: (obj: Record<string, unknown>, msg: string) => console.error(`  [error] ${msg}`, obj),
    debug: () => {},
    child: () => log,
  };
  return log;
}

interface CaseResult {
  source: string;
  newUtterance: string;
  expected: FollowUpVerdict;
  actual: FollowUpVerdict;
  pass: boolean;
  durationMs: number;
}

async function runCase(testCase: ClassifierCase): Promise<CaseResult> {
  const startedAt = Date.now();
  // classifyFollowUp never throws - an unreachable/erroring model already
  // fails closed to "noise" internally (see continuationCheck.ts), so a wrong
  // verdict here is real evidence of a bad call, not a crash to catch.
  const actual = await classifyFollowUp(
    testCase.lastUserMessage,
    testCase.lastAssistantMessage,
    testCase.newUtterance,
    createLogger(),
  );

  return {
    source: testCase.source,
    newUtterance: testCase.newUtterance,
    expected: testCase.expected,
    actual,
    pass: actual === testCase.expected,
    durationMs: Date.now() - startedAt,
  };
}

async function main(): Promise<void> {
  const { model, baseUrl } = parseArgs(process.argv.slice(2));

  process.env.OLLAMA_CLASSIFIER_MODEL = model;
  process.env.OLLAMA_CLASSIFIER_BASE_URL = baseUrl;
  reloadConfig();

  console.log(`Evaluating classifier model "${model}" at ${baseUrl} against ${CASES.length} cases...\n`);

  // Sequential, not parallel: production calls the classifier one turn at a
  // time against a single Ollama instance, so this measures the same
  // real-world latency a live conversation would see, not a best case under
  // request-batching that never happens in practice.
  const results: CaseResult[] = [];
  for (const testCase of CASES) {
    results.push(await runCase(testCase));
  }

  console.log("\nResults:");
  console.table(
    results.map(r => ({
      source: r.source,
      newUtterance: r.newUtterance,
      expected: r.expected,
      actual: r.actual,
      pass: r.pass ? "✓" : "✗",
      durationMs: r.durationMs,
    })),
  );

  const passed = results.filter(r => r.pass).length;
  const durations = results.map(r => r.durationMs);
  const avgMs = Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length);

  console.log(`\nAccuracy: ${passed}/${results.length} (${Math.round((passed / results.length) * 100)}%)`);
  console.log(`Latency:  min ${Math.min(...durations)}ms, max ${Math.max(...durations)}ms, avg ${avgMs}ms`);

  if (passed !== results.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
