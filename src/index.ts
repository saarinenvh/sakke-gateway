import "dotenv/config";
import { buildApp } from "./app.js";
import { loadEntities } from "./integrations/homeAssistant/registry.js";
import { setModuleLogger } from "./logger.js";
import { restoreTimers, setTimerHandler } from "./timers/timers.js";
import { announceFinishedTimer } from "./timers/timerAnnouncer.js";
import { config } from "./config.js";

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

// Starts either way - a dead HA at boot shouldn't stop the gateway coming up,
// and refresh_home_data can reload the registry once it's back.
loadEntities()
  .then(() => app.log.info("HA entities loaded"))
  .catch((err) => app.log.error({ err }, "Failed to load HA entities, starting anyway"))
  .finally(listen);
