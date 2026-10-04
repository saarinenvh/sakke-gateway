import type { FastifyBaseLogger } from "fastify";
import { config } from "../../config.js";
import { announce } from "../announcements/announcements.js";
import type { ScheduledJob } from "./db/ScheduledJob.entity.js";
import { outcomeMessage } from "./messages.js";
import { ANNOUNCE_TOOL, type JobOutcome } from "./scheduling.js";

// After a scheduled action, Sakke says how it went, done or failed. A
// scheduled announcement already said everything there was to say.
export async function reportOutcome(job: ScheduledJob, outcome: JobOutcome, log: FastifyBaseLogger): Promise<void> {
  if (job.tool === ANNOUNCE_TOOL) return;
  await announce(outcomeMessage(job, outcome, new Date(), config.timezone), log);
}
