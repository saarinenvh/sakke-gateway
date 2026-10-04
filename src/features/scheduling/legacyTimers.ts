import { promises as fs } from "fs";
import { join } from "path";
import { z } from "zod";
import type { FastifyBaseLogger } from "fastify";
import { parseOrThrow } from "../../util/validation.js";
import type { ScheduledJob } from "./db/ScheduledJob.entity.js";
import { defaultAnnouncement, type JobStore } from "./scheduling.js";

// Where the file-based timer scheduler kept its timers, in the state dir.
export const LEGACY_TIMERS_FILE = "timers.json";

const legacyTimersSchema = z.array(z.object({
  id: z.string(),
  label: z.string(),
  endsAt: z.number(),
}));

type LegacyTimer = z.output<typeof legacyTimersSchema>[number];

// Moves timers saved by the file-based scheduler into the database, once.
// Old ids are kept and existing ones ignored, and the file is deleted only
// after the import has committed, so a crash in between only repeats a
// harmless import. Run before the scheduler starts, which then arms them or
// drops the ones that expired while the gateway was down.
export async function importLegacyTimers(
  store: Pick<JobStore, "insertIgnoringExisting">,
  stateDir: string,
  now: Date,
  log: FastifyBaseLogger,
): Promise<number> {
  const file = join(stateDir, LEGACY_TIMERS_FILE);
  const contents = await readIfPresent(file);
  if (contents === undefined) return 0;

  const timers = parseLegacyTimers(contents, file, log);
  if (!timers) return 0;

  await store.insertIgnoringExisting(timers.map(timer => toJob(timer, now)));
  await fs.unlink(file);
  log.info({ imported: timers.length }, "Imported timers from timers.json");
  return timers.length;
}

async function readIfPresent(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf-8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return undefined;
    throw err;
  }
}

// A corrupt or hand-edited file is logged and left in place for inspection,
// not half-imported.
function parseLegacyTimers(contents: string, file: string, log: FastifyBaseLogger): LegacyTimer[] | undefined {
  try {
    return parseOrThrow(legacyTimersSchema, JSON.parse(contents), file);
  } catch (err) {
    log.warn({ file, err: err instanceof Error ? err.message : String(err) }, "Not importing an unreadable timers file");
    return undefined;
  }
}

function toJob(timer: LegacyTimer, now: Date): ScheduledJob {
  return {
    id: timer.id,
    runAt: new Date(timer.endsAt),
    source: "in",
    ...defaultAnnouncement(timer.label),
    label: timer.label,
    status: "pending",
    createdAt: now,
    finishedAt: null,
    result: null,
  };
}
