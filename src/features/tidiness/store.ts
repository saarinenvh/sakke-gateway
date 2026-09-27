import { promises as fs } from "fs";
import { join } from "path";
import { z } from "zod";
import { config } from "../../config.js";
import { moduleLog } from "../../logger.js";
import { parseOrThrow } from "../../util/validation.js";
import type { NagRecord } from "./policy.js";

// Everything the tidiness coach has to remember across a restart: when the
// house was last cleaned, a run in progress, the snooze, and every nag asked.
// Without the nag history a restart would forget a slot had been used and
// ask again.

const nagRecordSchema = z.object({
  slot: z.string(),
  askedAt: z.number(),
  delivery: z.enum(["delivered", "uncertain", "failed"]),
  answer: z.enum(["yes", "no"]).optional(),
}) satisfies z.ZodType<NagRecord>;

const tidinessStateSchema = z.object({
  lastCleanedAt: z.number().optional(),
  lastCleanedBy: z.enum(["vacuum", "manual"]).optional(),
  cleaningSince: z.number().optional(),
  snoozedUntil: z.number().optional(),
  nags: z.array(nagRecordSchema),
});

export type TidinessState = z.output<typeof tidinessStateSchema>;
export type CleanSource = NonNullable<TidinessState["lastCleanedBy"]>;

// Old nags are only needed for "was this slot used" and for counting "no"s
// since the last clean; a month covers both with room to spare.
const NAG_RETENTION_MS = 30 * 86_400_000;

let state: TidinessState = { nags: [] };

export function getTidinessState(): TidinessState {
  return state;
}

// --- Mutations (each one persists) ----------------------------------------

export function recordClean(at: number, source: CleanSource): Promise<void> {
  // Never move backwards: a late or repeated report of an older run must not
  // make the house look dirtier than it is.
  if (state.lastCleanedAt !== undefined && at <= state.lastCleanedAt) return Promise.resolve();
  return update({ ...state, lastCleanedAt: at, lastCleanedBy: source });
}

export function setCleaningSince(since: number | undefined): Promise<void> {
  if (state.cleaningSince === since) return Promise.resolve();
  return update({ ...state, cleaningSince: since });
}

export function snoozeUntil(until: number): Promise<void> {
  return update({ ...state, snoozedUntil: until });
}

export function recordNag(nag: NagRecord): Promise<void> {
  const recent = state.nags.filter(existing => existing.askedAt >= nag.askedAt - NAG_RETENTION_MS);
  return update({ ...state, nags: [...recent, nag] });
}

export function updateNag(slot: string, change: Partial<Pick<NagRecord, "delivery" | "answer">>): Promise<void> {
  const nags = state.nags.map(nag => (nag.slot === slot ? { ...nag, ...change } : nag));
  return update({ ...state, nags });
}

// --- Persistence ------------------------------------------------------------

function stateFile(): string {
  return join(config.stateDir, "tidiness.json");
}

// Called once at startup. A missing file is a first run; a corrupt one is
// logged and ignored, which means "never cleaned" - the quiet outcome.
export async function restoreTidinessState(): Promise<void> {
  let contents: string;
  try {
    contents = await fs.readFile(stateFile(), "utf-8");
  } catch {
    return;
  }

  try {
    state = parseOrThrow(tidinessStateSchema, JSON.parse(contents), stateFile());
  } catch (err) {
    moduleLog().warn({ err: err instanceof Error ? err.message : String(err) }, "Ignoring unreadable tidiness state");
  }
}

// For tests: forget everything, in memory only.
export function __resetTidinessState(): void {
  state = { nags: [] };
}

// Serialised, like the timers file: two overlapping writes would otherwise
// race on the same temp file.
let writeQueue: Promise<void> = Promise.resolve();

function update(next: TidinessState): Promise<void> {
  state = next;
  writeQueue = writeQueue.then(writeSnapshot, writeSnapshot);
  return writeQueue;
}

async function writeSnapshot(): Promise<void> {
  try {
    await fs.mkdir(config.stateDir, { recursive: true });
    const tmp = `${stateFile()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state), "utf-8");
    await fs.rename(tmp, stateFile());
  } catch (err) {
    // Best-effort, as with timers: the coach keeps working from memory, it
    // just won't remember across a restart.
    moduleLog().warn({ err: err instanceof Error ? err.message : String(err), file: stateFile() }, "Could not persist tidiness state");
  }
}
