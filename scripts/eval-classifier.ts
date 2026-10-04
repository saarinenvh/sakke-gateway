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
import { CLASSIFIER_HISTORY_EXCHANGES, classifyFollowUp, type Exchange, type FollowUpVerdict } from "../src/agent/continuationCheck.js";
import { reloadConfig } from "../src/config.js";

interface ClassifierCase {
  // Where this case came from, so a failing case can be traced back to real
  // evidence rather than an arbitrary guess at what the model should do.
  source: string;
  exchanges: Exchange[];
  newUtterance: string;
  expected: FollowUpVerdict;
}

// [source, lastUserMessage, lastAssistantMessage, newUtterance, expected, earlierExchange?] -
// a tuple table rather than repeated object literals, since the identical
// five-key shape repeated per case is exactly what a copy-paste detector
// flags as duplication even though only the values differ.
type ClassifierCaseRow = readonly [string, string, string, string, FollowUpVerdict, Exchange?];

const CASE_ROWS: ClassifierCaseRow[] = [
  ["live log, 2026-09-28 (sakke-gateway)", "What's the time?", "It's 21:39, Monday, 28 September 2026.", "Do I have any tasks for today?", "new_request"],
  // Probably "I already watered them", misheard by Whisper. As text it doesn't
  // follow from the reply, and the classifier only sees text.
  ["live log, 2026-09-28 (sakke-gateway), mis-transcribed", "Do I have any tasks for today?", "You have one task today: water the plants.", "I already bothered them.", "noise"],
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

  // The last exchange alone doesn't explain these; the one before it does.
  ["representative: refers back past a one-off question", "What's the weather tomorrow?", "Sunny, high of 18 degrees.", "Add milk to that list too.", "continuation", { user: "Add eggs to the shopping list.", assistant: "Added eggs to the shopping list." }],
  ["representative: returns to the music after a detour", "What's the weather like?", "Cloudy, 9 degrees, light rain this evening.", "skip this song", "continuation", { user: "Play something by Wintersun.", assistant: "Playing Wintersun's Time I." }],
  ["representative: asks about an earlier timer", "Turn on the kitchen lights.", "Kitchen lights are on.", "how long is left on it?", "continuation", { user: "Set a timer for the pasta.", assistant: "Timer set for ten minutes." }],
  ["representative: chatter about an earlier topic, to another person", "Turn off the living room lights.", "Living room lights are off.", "we should totally see them live next summer", "noise", { user: "Play something by Wintersun.", assistant: "Playing Wintersun's Time I." }],

  // Owner-written synthetic set, 2026-09-30: written after the prompt was
  // tuned, as a check on cases it was never shaped against.
  // Continuation: short answers, task updates, references, and adjustments.
  ["synthetic: acknowledgement accepting a pending offer", "It's too dark in here.", "Would you like me to turn on the living room lights?", "okay", "continuation"],
  // Never reaches the classifier live: sakke_agent closes the mic on a short
  // decline first. Silence is the harmless answer if it ever did.
  ["synthetic: rejects a pending offer (closed by sakke_agent)", "What's the weather tomorrow?", "Rain is expected. Would you like the hourly forecast?", "no thanks", "noise"],
  ["synthetic: supplies a missing room", "Turn on the lights.", "Which room?", "the kitchen", "continuation"],
  ["synthetic: supplies a missing shopping item", "Add something to my shopping list.", "What should I add?", "eggs", "continuation"],
  ["synthetic: clear completion update", "What tasks do I have today?", "Water the plants and take out the recycling.", "I already watered the plants.", "continuation"],
  ["synthetic: corrects the reported task state", "Have I finished my tasks?", "Taking out the recycling is still pending.", "That's done too.", "continuation"],
  ["synthetic: asks about the artist just played", "Play some Massive Attack.", "Playing Mezzanine by Massive Attack.", "Where is that group from?", "continuation"],
  ["synthetic: asks about a specific album without a pronoun", "Play an album by Daft Punk.", "Playing Discovery by Daft Punk.", "When was Discovery released?", "continuation"],
  ["synthetic: requests explanation of previous recommendation", "Should I cycle to work?", "The bus would be a better choice because heavy rain is expected.", "Why the bus?", "continuation"],
  ["synthetic: modifies a running timer", "Set a timer for twenty minutes.", "Your twenty-minute timer is running.", "Make it thirty instead.", "continuation"],
  ["synthetic: stops an ongoing action", "Play my workout playlist.", "Playing your workout playlist.", "stop", "continuation"],
  ["synthetic: extends the current lighting action", "Turn off the kitchen lights.", "The kitchen lights are off.", "The hallway too.", "continuation"],

  // New requests: standalone goals, topic changes, and generic replies.
  ["synthetic: standalone timer after a weather question", "Will it rain today?", "Rain is expected this afternoon.", "Remind me to call the dentist tomorrow morning.", "new_request"],
  ["synthetic: unrelated request instead of answering a pending question", "Play some music.", "Which playlist would you like?", "What's the capital of Finland?", "new_request"],
  ["synthetic: fresh request after a generic greeting", "Hello.", "Hi! How can I help?", "Turn on the porch lights.", "new_request"],
  ["synthetic: fresh request after a generic recovery response", "Can you hear me?", "I'm here. What would you like me to do?", "Add bananas to my shopping list.", "new_request"],
  ["synthetic: new lighting task after a music action", "Pause the music.", "The music is paused.", "Dim the bedroom lights to twenty percent.", "new_request"],
  ["synthetic: new music task after a lighting action", "Turn on the kitchen lights.", "The kitchen lights are on.", "Play a jazz playlist.", "new_request"],
  ["synthetic: unrelated factual question after shopping", "Add bread to my shopping list.", "Added bread to your shopping list.", "Why do leaves change color in autumn?", "new_request"],
  ["synthetic: independent TV command after a timer", "Set a timer for five minutes.", "Your five-minute timer is running.", "Turn off the TV.", "new_request"],
  ["synthetic: standalone shopping request after weather", "What's the temperature outside?", "It's eight degrees.", "Add coffee and oat milk to my shopping list.", "new_request"],
  ["synthetic: multi-step routine after unrelated factual answer", "What is the tallest mountain in the world?", "Mount Everest.", "Set a fifteen-minute timer, turn on the kitchen lights, and play quiet music.", "new_request"],
  ["synthetic: planning request after a completed device action", "Turn off the TV.", "The TV is off.", "Plan three vegetarian dinners with overlapping ingredients and make a shopping list.", "new_request"],
  ["synthetic: explicit topic switch", "What's the weather tomorrow?", "Sunny with a high of seventeen degrees.", "Different question: how do solar panels work?", "new_request"],

  // Noise: acknowledgements, human-directed speech, reactions, and fragments.
  ["synthetic: acknowledgement with no pending offer", "Turn on the living room lights.", "The living room lights are on.", "okay", "noise"],
  ["synthetic: short noun without a pending question or related task", "Turn off the TV.", "The TV is off.", "eggs", "noise"],
  ["synthetic: same-topic command explicitly addressed to a person", "Turn on the kitchen lights.", "The kitchen lights are on.", "Maya, turn off the hallway lights on your way out.", "noise"],
  ["synthetic: same-topic question explicitly addressed to a person", "What's on my shopping list?", "Milk and bread.", "Dad, did you buy the milk?", "noise"],
  ["synthetic: overheard phone call with explicit human addressee", "What's the weather?", "Sunny and fourteen degrees.", "Hi Alex, I'm on the bus. I'll call you when I get home.", "noise"],
  ["synthetic: personal reaction to the current music", "Play some jazz.", "Playing a jazz playlist.", "My dad used to listen to this kind of music.", "noise"],
  ["synthetic: personal reaction to the weather report", "Will it rain this afternoon?", "Heavy rain is expected after three.", "Ugh, typical.", "noise"],
  ["synthetic: unfinished request missing the action target", "What's the time?", "It's half past four.", "Could you put the", "noise"],
  ["synthetic: unfinished conditional", "What's the weather tomorrow?", "Rain is expected in the morning.", "If tomorrow is", "noise"],
  ["synthetic: hesitation while an answer is pending", "Set a timer.", "For how long?", "uhh", "noise"],
  ["synthetic: social remark after a completed task", "Turn off the bedroom lights.", "The bedroom lights are off.", "What a long day.", "noise"],
  ["synthetic: task update explicitly addressed to another person", "What tasks do I have today?", "Water the plants.", "Sam, I already watered the plants, so you don't need to.", "noise"],
];

const CASES: ClassifierCase[] = CASE_ROWS.map(
  ([source, lastUserMessage, lastAssistantMessage, newUtterance, expected, earlierExchange]) => ({
    source,
    exchanges: [...(earlierExchange ? [earlierExchange] : []), { user: lastUserMessage, assistant: lastAssistantMessage }],
    newUtterance,
    expected,
  }),
);

interface EvalOptions {
  model: string;
  baseUrl: string;
  runs: number;
  exchangeCount: number;
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

  const exchangeCount = Number(flags.get("exchanges") || CLASSIFIER_HISTORY_EXCHANGES);
  if (!Number.isInteger(exchangeCount) || exchangeCount < 1) {
    throw new Error(`--exchanges must be a positive integer, got "${flags.get("exchanges")}"`);
  }

  return { model, baseUrl, runs, exchangeCount };
}

// Prints only warnings and errors, and captures the model's raw response so
// isRecognizedVerdict can tell a real verdict from the fail-closed default.
function createLogger() {
  let raw: string | undefined;
  let complexity: number | undefined;
  let decidedByRule = false;
  const log: any = {
    info: (obj: Record<string, unknown>, msg: string) => {
      if (msg !== "Follow-up classification") return;
      if (typeof obj.raw === "string") raw = obj.raw;
      if (typeof obj.complexity === "number") complexity = obj.complexity;
      if (typeof obj.decidedBy === "string") decidedByRule = true;
    },
    warn: (obj: Record<string, unknown>, msg: string) => console.warn(`  [warn] ${msg}`, obj),
    error: (obj: Record<string, unknown>, msg: string) => console.error(`  [error] ${msg}`, obj),
    debug: () => {},
    child: () => log,
  };
  return { log, getRaw: () => raw, getComplexity: () => complexity, wasDecidedByRule: () => decidedByRule };
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
  const { model, baseUrl, runs, exchangeCount } = parseArgs(process.argv.slice(2));

  process.env.OLLAMA_CLASSIFIER_MODEL = model;
  process.env.OLLAMA_CLASSIFIER_BASE_URL = baseUrl;
  reloadConfig();

  console.log(`Warming up "${model}" at ${baseUrl}...`);
  await warmUpModel();

  console.log(`Evaluating ${CASES.length} cases x ${runs} runs, last ${exchangeCount} exchange(s) of history...\n`);
  const results = await evaluateCases(runs, exchangeCount);

  printResults(results);
  const allPassed = results.every(result => result.outcomes.every(outcome => outcome.pass));
  if (!allPassed) process.exitCode = 1;
}

// The first request pays for loading the model; keep that out of the latency
// figures. A failed warm-up means every case would fail the same way.
async function warmUpModel(): Promise<void> {
  const [firstCase] = CASES;
  const { log, getRaw } = createLogger();
  await classifyFollowUp(firstCase.exchanges, firstCase.newUtterance, log);
  if (!isRecognizedVerdict(getRaw())) {
    throw new Error("Warm-up call got no usable verdict. Check that Ollama is reachable and the model is pulled.");
  }
}

// Sequential, like production: one classifier call at a time against a single
// Ollama, so the latency matches what a live conversation sees.
async function evaluateCases(runs: number, exchangeCount: number): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const testCase of CASES) {
    const outcomes: RunOutcome[] = [];
    for (let run = 0; run < runs; run++) {
      outcomes.push(await runCase(testCase, exchangeCount));
    }
    results.push({ testCase, outcomes });
  }
  return results;
}

async function runCase(testCase: ClassifierCase, exchangeCount: number): Promise<RunOutcome> {
  const startedAt = Date.now();
  const { log, getRaw, getComplexity, wasDecidedByRule } = createLogger();
  const actual = await classifyFollowUp(testCase.exchanges.slice(-exchangeCount), testCase.newUtterance, log);

  return {
    actual,
    complexity: getComplexity(),
    // A rule-decided verdict never reaches the model, so there's no raw reply to check.
    pass: (wasDecidedByRule() || isRecognizedVerdict(getRaw())) && actual === testCase.expected,
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

  const silencedRequests = results
    .filter(result => result.testCase.expected !== "noise")
    .flatMap(result => result.outcomes)
    .filter(outcome => outcome.actual === "noise").length;
  console.log(`Real requests silenced as noise (worst error): ${silencedRequests}`);

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
