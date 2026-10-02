import "dotenv/config";
import type { DataSource } from "typeorm";
import { buildApp } from "./app.js";
import { loadEntities } from "./integrations/homeAssistant/registry.js";
import { setModuleLogger } from "./logger.js";
import { setWordingWriter } from "./features/announcements/announcer.js";
import { writeAnnouncementWording } from "./features/announcements/wording.js";
import { config } from "./config.js";
import { restoreTidinessState } from "./features/tidiness/store.js";
import { startTidinessCoach } from "./features/tidiness/coach.js";
import { liveCoachDeps } from "./features/tidiness/liveDeps.js";
import { createDataSource } from "./db/dataSource.js";
import { connectDatabase, DATABASE_RETRY_DELAY_MS } from "./db/database.js";
import { JobRepository } from "./features/scheduling/jobRepository.js";
import { importLegacyTimers } from "./features/scheduling/legacyTimers.js";
import { startScheduler } from "./features/scheduling/scheduler.js";
import { isSchedulable, runScheduledCall } from "./tools/registry.js";
import { MorningRepository } from "./features/morning/morningRepository.js";
import { setCoffeeAnswerStore } from "./features/morning/coffee.js";
import { startMorningWakeUp } from "./features/morning/wakeUp.js";
import { createLiveBriefDeps, createLiveMorningDeps } from "./features/morning/liveDeps.js";
import { startMorningBrief } from "./features/morning/brief.js";
import { getCalendarText, getTasksText } from "./tools/reminders/reminders.js";
import { getWeather } from "./tools/weather/weather.js";

const app = buildApp();

// Modules without a request logger (scenes.ts, spotify.ts) log through this.
setModuleLogger(app.log);

// Composition root: wired here so neither announce nor the scheduler has to
// import the agent or the tool registry, which imports every tool.
setWordingWriter(writeAnnouncementWording);

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

// The morning wake-up and day summary keep all their state in the database, so
// they only start once that is connected: until then they do nothing.
function startMorning(dataSource: DataSource): void {
  const morning = new MorningRepository(dataSource);
  setCoffeeAnswerStore(morning);
  startMorningWakeUp(createLiveMorningDeps(morning));
  startMorningBrief(createLiveBriefDeps(morning, {
    readCalendar: () => getCalendarText("today"),
    readTasks: () => getTasksText("today"),
    readWeather: () => getWeather(),
  }));
}

// Not awaited: the gateway serves requests while the database is still
// connecting, or unreachable. A missing config is already a reported problem.
if (config.database) {
  void connectDatabase(createDataSource(config.database), DATABASE_RETRY_DELAY_MS)
    .then(async dataSource => {
      startMorning(dataSource);
      await startScheduling(dataSource);
    })
    .catch(err => app.log.error({ err: err instanceof Error ? err.message : String(err) }, "Scheduling failed to start, unavailable until restart"));
}

// State first, so the first tick knows what was already asked before a restart.
void restoreTidinessState().then(() => startTidinessCoach(liveCoachDeps));

// Starts either way - a dead HA at boot shouldn't stop the gateway coming up,
// and refresh_home_data can reload the registry once it's back.
loadEntities()
  .then(() => app.log.info("HA entities loaded"))
  .catch((err) => app.log.error({ err }, "Failed to load HA entities, starting anyway"))
  .finally(listen);
