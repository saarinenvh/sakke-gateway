// Dev tool, not shipped app code (excluded from tsconfig.build.json the same
// way *.test.ts is - see tsconfig.build.json's comment). Compares candidate
// classifier models on both accuracy and latency against the real
// classifyFollowUp function, so a smaller model can be evaluated before it's
// trusted in production - this classifier has previously shipped real
// misclassification bugs, so "faster" alone isn't enough evidence to swap it.
//
// Usage:
//   npm run eval:classifier -- --model=qwen2.5:1.5b
//   npm run eval:classifier -- --model=qwen2.5:1.5b --baseUrl=http://100.90.103.31:11434 --runs=5
//
// Requires a real, reachable Ollama instance with the given model already
// pulled - this hits the network for real, unlike the rest of this repo's
// fully-hermetic tests, which is why it's a script rather than a vitest case.
//
// Compiled with tsc and run with node rather than ts-node: ts-node's CJS hook
// can't resolve this codebase's `.js`-suffixed imports of `.ts` files.
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
  ["live log, 2026-09-30 (sakke-gateway)", "What's the weather like?", "Clear sky, 12.3°C. Wind at 7.2 km/h, gusting to 16.6 km/h. No rain in the next six hours.", "Is it good weather for disc golf?", "continuation"],
  ["pending_tasks.md: generic open-ended reply must not force continuation by default", "Play some metal.", "Still here... what can I do for you?", "Could you light the campfire?", "new_request"],
  ["representative: direct pick from a just-presented option list", "Play the Discover Weekly playlist.", "Found: 1. Discover Weekly, 2. Metal, 3. Chill. Which one?", "The first one.", "continuation"],
  ["representative: same-topic follow-up referencing the prior subject", "Play something by Wintersun.", "Playing Wintersun's Time I.", "What other albums does that artist have?", "continuation"],
  ["representative: unrelated command after a finished task", "What's the weather like?", "Cloudy, 9 degrees, light rain this evening.", "Set a timer for ten minutes.", "new_request"],
  ["representative: unrelated question after music", "Play something by Wintersun.", "Playing Wintersun's Time I.", "What's on my shopping list?", "new_request"],

  // Short replies that look like noise out of context but answer or adjust
  // what the assistant just did - a fix for noise must not silence these.
  ["representative: bare confirmation of an offer", "Turn off the living room lights.", "Living room lights are off. Want me to dim the bedroom too?", "yeah do it", "continuation"],
  ["representative: one-word yes to a question", "Set a timer for the pasta.", "How long should the timer be?", "Ten minutes.", "continuation"],
  ["representative: bare ordinal pick", "Play some chill music.", "Found: 1. Chill Vibes, 2. Lo-fi Beats. Which one?", "the second", "continuation"],
  ["representative: correction of what was just done", "Play the Metal playlist.", "Playing Discover Weekly.", "no, the other one", "continuation"],
  ["representative: terse adjustment of the running action", "Play something by Wintersun.", "Playing Wintersun's Time I.", "louder", "continuation"],

  ["representative: background chatter not directed at the assistant", "What's the weather tomorrow?", "Sunny, high of 18 degrees.", "yeah I know right, so annoying", "noise"],
  ["representative: incomplete fragment", "Turn off the living room lights.", "Living room lights are off.", "and then the", "noise"],
  ["representative: fragment cut off mid-sentence", "What's the weather like?", "Cloudy, 9 degrees, light rain this evening.", "so if we", "noise"],
  ["representative: hesitation sound", "Turn off the living room lights.", "Living room lights are off.", "hmm", "noise"],
  ["representative: acknowledgement of a statement, nothing asked", "Turn off the living room lights.", "Living room lights are off.", "okay", "noise"],
  ["representative: speech addressed to another person", "Add milk to the shopping list.", "Added milk to the shopping list.", "Honey, can you get the door?", "noise"],
  ["representative: one side of a phone call", "What's the weather like?", "Clear sky, 12 degrees.", "Yeah, I'll be there around six, see you.", "noise"],
  ["representative: on-topic reaction to music, not a request", "Play something by Wintersun.", "Playing Wintersun's Time I.", "oh man, this album brings back memories", "noise"],

  // Multi-step requests, so the complexity spike has something high to rate.
  ["representative: multi-step planning request", "What's the weather like?", "Cloudy, 9 degrees, light rain this evening.", "Plan my evening: cook something with what's on my shopping list, then set a cozy scene for a movie.", "new_request"],
  ["representative: open-ended design request", "Turn off the living room lights.", "Living room lights are off.", "Design a warm autumn lighting scene for the whole house and tell me why you picked it.", "new_request"],
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

interface EvalOptions {
  model: string;
  baseUrl: string;
  runs: number;
}

const DEFAULT_RUNS = 3;

function parseArgs(argv: string[]): EvalOptions {
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

  const runs = Number(flags.get("runs") || DEFAULT_RUNS);
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`--runs must be a positive integer, got "${flags.get("runs")}"`);
  }

  return { model, baseUrl, runs };
}

// Prints only warnings and errors, and captures the model's raw response so
// isRecognizedVerdict can tell a real verdict from the fail-closed default.
function createLogger() {
  let raw: string | undefined;
  let complexity: number | undefined;
  const log: any = {
    info: (obj: Record<string, unknown>, msg: string) => {
      if (msg !== "Follow-up classification") return;
      if (typeof obj.raw === "string") raw = obj.raw;
      if (typeof obj.complexity === "number") complexity = obj.complexity;
    },
    warn: (obj: Record<string, unknown>, msg: string) => console.warn(`  [warn] ${msg}`, obj),
    error: (obj: Record<string, unknown>, msg: string) => console.error(`  [error] ${msg}`, obj),
    debug: () => {},
    child: () => log,
  };
  return { log, getRaw: () => raw, getComplexity: () => complexity };
}

// classifyFollowUp maps unparseable output and failed calls to "noise", so
// without this a garbage reply would pass every noise case.
function isRecognizedVerdict(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return raw.includes("new_request") || raw.includes("new request") || raw.includes("continuation") || raw.includes("noise");
}

interface RunOutcome {
  actual: FollowUpVerdict;
  complexity: number | undefined;
  pass: boolean;
  durationMs: number;
}

interface CaseResult {
  testCase: ClassifierCase;
  outcomes: RunOutcome[];
}

async function main(): Promise<void> {
  const { model, baseUrl, runs } = parseArgs(process.argv.slice(2));

  process.env.OLLAMA_CLASSIFIER_MODEL = model;
  process.env.OLLAMA_CLASSIFIER_BASE_URL = baseUrl;
  reloadConfig();

  console.log(`Warming up "${model}" at ${baseUrl}...`);
  await warmUpModel();

  console.log(`Evaluating ${CASES.length} cases x ${runs} runs...\n`);
  const results = await evaluateCases(runs);

  printResults(results);
  const allPassed = results.every(result => result.outcomes.every(outcome => outcome.pass));
  if (!allPassed) process.exitCode = 1;
}

// The first request pays for loading the model; keep that out of the latency
// figures. A failed warm-up means every case would fail the same way.
async function warmUpModel(): Promise<void> {
  const [firstCase] = CASES;
  const { log, getRaw } = createLogger();
  await classifyFollowUp(firstCase.lastUserMessage, firstCase.lastAssistantMessage, firstCase.newUtterance, log);
  if (!isRecognizedVerdict(getRaw())) {
    throw new Error("Warm-up call got no usable verdict. Check that Ollama is reachable and the model is pulled.");
  }
}

// Sequential, like production: one classifier call at a time against a single
// Ollama, so the latency matches what a live conversation sees.
async function evaluateCases(runs: number): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const testCase of CASES) {
    const outcomes: RunOutcome[] = [];
    for (let run = 0; run < runs; run++) {
      outcomes.push(await runCase(testCase));
    }
    results.push({ testCase, outcomes });
  }
  return results;
}

async function runCase(testCase: ClassifierCase): Promise<RunOutcome> {
  const startedAt = Date.now();
  const { log, getRaw, getComplexity } = createLogger();
  const actual = await classifyFollowUp(testCase.lastUserMessage, testCase.lastAssistantMessage, testCase.newUtterance, log);

  return {
    actual,
    complexity: getComplexity(),
    pass: isRecognizedVerdict(getRaw()) && actual === testCase.expected,
    durationMs: Date.now() - startedAt,
  };
}

function printResults(results: CaseResult[]): void {
  console.table(
    results.map(({ testCase, outcomes }) => ({
      source: testCase.source,
      newUtterance: testCase.newUtterance,
      expected: testCase.expected,
      verdicts: summarizeVerdicts(outcomes),
      passed: `${countPasses(outcomes)}/${outcomes.length}`,
      complexity: outcomes.map(outcome => outcome.complexity ?? "-").join(" "),
    })),
  );

  const outcomes = results.flatMap(result => result.outcomes);
  console.log(`\nAccuracy: ${formatRatio(countPasses(outcomes), outcomes.length)}`);
  for (const verdict of FOLLOW_UP_VERDICTS) {
    const ofVerdict = results.filter(result => result.testCase.expected === verdict).flatMap(result => result.outcomes);
    console.log(`  ${verdict.padEnd(12)} ${formatRatio(countPasses(ofVerdict), ofVerdict.length)}`);
  }

  const stableCases = results.filter(result => result.outcomes.every(outcome => outcome.pass)).length;
  console.log(`Cases passing every run: ${stableCases}/${results.length}`);

  const durations = outcomes.map(outcome => outcome.durationMs);
  const avgMs = Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length);
  console.log(`Latency: min ${Math.min(...durations)}ms, max ${Math.max(...durations)}ms, avg ${avgMs}ms`);
}

const FOLLOW_UP_VERDICTS: readonly FollowUpVerdict[] = ["continuation", "new_request", "noise"];

// e.g. "continuation x2, noise x1"
function summarizeVerdicts(outcomes: RunOutcome[]): string {
  const counts = new Map<FollowUpVerdict, number>();
  for (const { actual } of outcomes) counts.set(actual, (counts.get(actual) ?? 0) + 1);
  return [...counts].map(([verdict, count]) => `${verdict} x${count}`).join(", ");
}

function countPasses(outcomes: RunOutcome[]): number {
  return outcomes.filter(outcome => outcome.pass).length;
}

function formatRatio(passed: number, total: number): string {
  return `${passed}/${total} (${Math.round((passed / total) * 100)}%)`;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
