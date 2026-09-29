import "dotenv/config";
import { buildApp } from "./app.js";
import { loadEntities } from "./integrations/homeAssistant/registry.js";
import { setModuleLogger } from "./logger.js";
import { restoreTimers, setTimerHandler } from "./tools/timers/timers.js";
import { announceFinishedTimer } from "./tools/timers/timerAnnouncer.js";
import { config } from "./config.js";
import { restoreTidinessState } from "./features/tidiness/store.js";
import { startTidinessCoach } from "./features/tidiness/coach.js";
import { liveCoachDeps } from "./features/tidiness/liveDeps.js";
import { createDataSource } from "./db/dataSource.js";
import { connectDatabase, DATABASE_RETRY_DELAY_MS } from "./db/database.js";

const app = buildApp();

// Modules without a request logger (scenes.ts, spotify.ts) log through this.
setModuleLogger(app.log);

// Composition root: the scheduler knows when a timer fires, this decides what
// happens when it does. Wired here so timers.ts doesn't have to import the
// agent - see the note in that file about the import cycle.
setTimerHandler(announceFinishedTimer);

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

void restoreTimers();

// Not awaited: the gateway serves requests while the database is still
// connecting, or unreachable. A missing config is already a reported problem.
if (config.database) {
  void connectDatabase(createDataSource(config.database), DATABASE_RETRY_DELAY_MS);
}

// State first, so the first tick knows what was already asked before a restart.
void restoreTidinessState().then(() => startTidinessCoach(liveCoachDeps));

// Starts either way - a dead HA at boot shouldn't stop the gateway coming up,
// and refresh_home_data can reload the registry once it's back.
loadEntities()
  .then(() => app.log.info("HA entities loaded"))
  .catch((err) => app.log.error({ err }, "Failed to load HA entities, starting anyway"))
  .finally(listen);
