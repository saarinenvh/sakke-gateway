import "dotenv/config";
import type { DataSource } from "typeorm";
import { buildApp } from "./app.js";
import { loadEntities } from "./integrations/homeAssistant/registry.js";
import { setModuleLogger } from "./logger.js";
import { config } from "./config.js";
import { startTidiness } from "./features/tidiness/tidiness.js";
import { createDataSource } from "./db/dataSource.js";
import { connectDatabase, DATABASE_RETRY_DELAY_MS } from "./db/database.js";
import { JobRepository } from "./features/scheduling/db/jobRepository.js";
import { importLegacyTimers } from "./features/scheduling/legacyTimers.js";
import { startScheduler } from "./features/scheduling/scheduler.js";
import { isSchedulable, runScheduledCall } from "./tools/registry.js";
import { MorningRepository } from "./features/morning/db/morningRepository.js";
import { startMorning } from "./features/morning/morning.js";
import { setSystemPromptBuilder } from "./inference/systemPrompt.js";
import { buildSystemPrompt } from "./agent/systemPrompt.js";

const app = buildApp();

// Modules without a request logger (scenes.ts, spotify.ts) log through this.
setModuleLogger(app.log);

// Composition root. Sakke's system prompt is composed from every tool's
// prompt section, and inference/ sits below the tools, so it's wired in here.
setSystemPromptBuilder(buildSystemPrompt);

// Anything missing or implausible in the environment, reported once, up front,
// instead of surfacing later as an inexplicable runtime failure.
for (const problem of config.problems) {
  app.log.error({ problem }, "Configuration problem");
}

function listen(): void {
  app.listen({ port: config.port, host: "0.0.0.0" }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}

// Once the database is connected: move any timers left in timers.json into
// it, then arm every pending job. Until then scheduling reports itself
// unavailable.
async function startScheduling(dataSource: DataSource): Promise<void> {
  const jobs = new JobRepository(dataSource);
  await importLegacyTimers(jobs, config.stateDir, new Date(), app.log);
  await startScheduler({
    store: jobs,
    runJob: job => runScheduledCall(job, app.log),
    isSchedulable,
    now: () => new Date(),
    log: app.log,
  });
}

// Not awaited: the gateway serves requests while the database is still
// connecting, or unreachable. A missing config is already a reported problem.
if (config.database) {
  void connectDatabase(createDataSource(config.database), DATABASE_RETRY_DELAY_MS)
    .then(async dataSource => {
      startMorning(new MorningRepository(dataSource));
      await startScheduling(dataSource);
    })
    .catch(err => app.log.error({ err: err instanceof Error ? err.message : String(err) }, "Scheduling failed to start, unavailable until restart"));
}

void startTidiness();

// Starts either way - a dead HA at boot shouldn't stop the gateway coming up,
// and refresh_home_data can reload the registry once it's back.
loadEntities()
  .then(() => app.log.info("HA entities loaded"))
  .catch((err) => app.log.error({ err }, "Failed to load HA entities, starting anyway"))
  .finally(listen);
