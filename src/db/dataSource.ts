import "reflect-metadata";
import { DataSource } from "typeorm";
import type { DatabaseConfig } from "../config.js";
import { ScheduledJob } from "../features/scheduling/ScheduledJob.entity.js";
import { MorningDay } from "../features/morning/MorningDay.entity.js";
import { MorningState } from "../features/morning/MorningState.entity.js";
import { CreateScheduledJob1790682762782 } from "./migrations/1790682762782-CreateScheduledJob.js";
import { CreateMorning1791028800000 } from "./migrations/1791028800000-CreateMorning.js";

// MariaDB drops connections idle longer than its wait_timeout (8 h by
// default), and the scheduler can sit idle overnight. With no idle
// connections kept, the pool closes each one after its idle timeout (60 s),
// so every query after a quiet spell gets a fresh connection.
const MAX_IDLE_POOL_CONNECTIONS = 0;

export function createDataSource(database: DatabaseConfig): DataSource {
  return new DataSource({
    type: "mariadb",
    host: database.host,
    port: database.port,
    username: database.username,
    password: database.password,
    database: database.name,
    charset: "utf8mb4_unicode_ci",
    timezone: "Z",
    synchronize: false,
    migrationsRun: true,
    entities: [ScheduledJob, MorningState, MorningDay],
    migrations: [CreateScheduledJob1790682762782, CreateMorning1791028800000],
    extra: { maxIdle: MAX_IDLE_POOL_CONNECTIONS },
  });
}
