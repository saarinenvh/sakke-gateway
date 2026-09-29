import type { DataSource } from "typeorm";
import { moduleLog } from "../logger.js";

export const DATABASE_RETRY_DELAY_MS = 30_000;

// Keeps trying until the database is reachable and its migrations have run,
// so a MariaDB that is down or slow at boot never stops the gateway starting.
// Callers wait on the returned promise; nothing else blocks on it.
export async function connectDatabase(dataSource: DataSource, retryDelayMs: number): Promise<DataSource> {
  for (let attempt = 1; ; attempt++) {
    try {
      await dataSource.initialize();
      moduleLog().info({ attempt }, "Gateway database connected and migrated");
      return dataSource;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      moduleLog().warn({ attempt, err: message, retryInMs: retryDelayMs }, "Gateway database unavailable, retrying");
      await wait(retryDelayMs);
    }
  }
}

function wait(durationMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, durationMs));
}
