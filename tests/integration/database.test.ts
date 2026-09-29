import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataSource } from "typeorm";
import type { DatabaseConfig } from "../../src/config.js";
import { createDataSource } from "../../src/db/dataSource.js";
import { connectDatabase } from "../../src/db/database.js";
import { ScheduledJob } from "../../src/db/entities/ScheduledJob.js";

// Runs against a real MariaDB only when TEST_DB_HOST is set: the CI service
// container, or a local throwaway database. It drops the gateway's tables
// first, so it must never point at a database holding real data.
const testDatabase: DatabaseConfig | null = process.env.TEST_DB_HOST
  ? {
      host: process.env.TEST_DB_HOST,
      port: Number(process.env.TEST_DB_PORT ?? 3306),
      name: process.env.TEST_DB_NAME ?? "sakke_gateway_test",
      username: process.env.TEST_DB_USERNAME ?? "sakke_gateway_test",
      password: process.env.TEST_DB_PASSWORD ?? "",
    }
  : null;

const NO_RETRY_DELAY_MS = 0;

async function dropGatewayTables(database: DatabaseConfig): Promise<void> {
  const admin = new DataSource({
    type: "mariadb",
    host: database.host,
    port: database.port,
    username: database.username,
    password: database.password,
    database: database.name,
  });
  await admin.initialize();
  await admin.query("DROP TABLE IF EXISTS scheduled_job, migrations");
  await admin.destroy();
}

async function appliedMigrationNames(dataSource: DataSource): Promise<string[]> {
  const rows: { name: string }[] = await dataSource.query("SELECT name FROM migrations ORDER BY id");
  return rows.map(row => row.name);
}

describe.skipIf(testDatabase === null)("gateway database on MariaDB", () => {
  // Non-null inside this block: skipIf has already excluded the null case.
  const database = testDatabase as DatabaseConfig;
  let dataSource: DataSource;

  beforeAll(async () => {
    await dropGatewayTables(database);
    dataSource = await connectDatabase(createDataSource(database), NO_RETRY_DELAY_MS);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it("runs the first migration on an empty database", async () => {
    expect(await appliedMigrationNames(dataSource)).toEqual(["CreateScheduledJob1790682762782"]);
  });

  it("round-trips a job: the stored call, a Finnish label, and a millisecond UTC time", async () => {
    const runAt = new Date("2026-10-25T01:30:00.123Z");
    const repository = dataSource.getRepository(ScheduledJob);
    await repository.save(repository.create({
      id: "x7k2p",
      runAt,
      source: "at",
      tool: "announce",
      args: { message: "Ota jauheliha pois jääkaapista", nested: { minutes: 10 } },
      label: "jauheliha pois jääkaapista",
      status: "pending",
      createdAt: new Date("2026-09-29T12:00:00.000Z"),
      finishedAt: null,
      result: null,
    }));

    const stored = await repository.findOneByOrFail({ id: "x7k2p" });
    expect(stored.runAt.toISOString()).toBe(runAt.toISOString());
    expect(stored.args).toEqual({ message: "Ota jauheliha pois jääkaapista", nested: { minutes: 10 } });
    expect(stored.label).toBe("jauheliha pois jääkaapista");
    expect(stored.finishedAt).toBeNull();
  });

  it("does not run a migration again on the next start, and keeps the data", async () => {
    await dataSource.destroy();
    dataSource = await connectDatabase(createDataSource(database), NO_RETRY_DELAY_MS);

    expect(await appliedMigrationNames(dataSource)).toEqual(["CreateScheduledJob1790682762782"]);
    expect(await dataSource.getRepository(ScheduledJob).countBy({ id: "x7k2p" })).toBe(1);
  });
});
