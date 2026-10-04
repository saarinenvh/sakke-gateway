import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DataSource } from "typeorm";
import type { DatabaseConfig } from "../../src/config.js";
import { createDataSource } from "../../src/db/dataSource.js";
import { connectDatabase } from "../../src/db/database.js";
import { ScheduledJob } from "../../src/features/scheduling/db/ScheduledJob.entity.js";
import { JobRepository } from "../../src/features/scheduling/db/jobRepository.js";
import { MorningBrief } from "../../src/features/morning/db/MorningBrief.entity.js";
import { MorningDay } from "../../src/features/morning/db/MorningDay.entity.js";
import { MorningRepository } from "../../src/features/morning/db/morningRepository.js";

// Runs against a real MariaDB only when TEST_DB_HOST is set: the CI service
// container, or a local throwaway database. It drops the gateway's tables
// first, so it must never point at a database holding real data. Every test
// that needs the database lives in this one file: test files run in
// parallel, and two of them dropping the same tables would race.
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
  await admin.query("DROP TABLE IF EXISTS scheduled_job, morning_brief, morning_day, morning_state, migrations");
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

  const ALL_MIGRATIONS = ["CreateScheduledJob1790682762782", "CreateMorning1791028800000", "CreateMorningBrief1791049800000"];

  it("runs every migration on an empty database", async () => {
    expect(await appliedMigrationNames(dataSource)).toEqual(ALL_MIGRATIONS);
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

    expect(await appliedMigrationNames(dataSource)).toEqual(ALL_MIGRATIONS);
    expect(await dataSource.getRepository(ScheduledJob).countBy({ id: "x7k2p" })).toBe(1);
  });

  describe("JobRepository", () => {
    let jobs: JobRepository;

    const job = (id: string, minutesFromNow: number): ScheduledJob => ({
      id,
      runAt: new Date(Date.UTC(2026, 8, 29, 9, minutesFromNow)),
      source: "in",
      tool: "announce",
      args: { message: `job ${id}` },
      label: `job ${id}`,
      status: "pending",
      createdAt: new Date(Date.UTC(2026, 8, 29, 9, 0)),
      finishedAt: null,
      result: null,
    });

    beforeEach(async () => {
      await dataSource.query("DELETE FROM scheduled_job");
      jobs = new JobRepository(dataSource);
    });

    it("lists pending jobs soonest first, leaving finished ones out", async () => {
      await jobs.insert(job("late", 30));
      await jobs.insert(job("soon", 5));
      await jobs.insert(job("done", 1));
      await jobs.claim("done");
      await jobs.finish("done", "done", "Announced.", new Date());

      expect((await jobs.listPending()).map(pending => pending.id)).toEqual(["soon", "late"]);
    });

    it("refuses a second job with the same id", async () => {
      await jobs.insert(job("same", 5));
      await expect(jobs.insert(job("same", 10))).rejects.toThrow();
    });

    it("finishes only a pending job, so a cancelled one can't be marked done", async () => {
      await jobs.insert(job("gone", 5));

      expect(await jobs.finish("gone", "cancelled", null, new Date())).toBe(true);
      expect(await jobs.finish("gone", "done", "Announced.", new Date())).toBe(false);
      expect((await dataSource.getRepository(ScheduledJob).findOneByOrFail({ id: "gone" })).status).toBe("cancelled");
    });

    it("claims a pending job once, and lists it as running until it finishes", async () => {
      await jobs.insert(job("due", 5));

      expect(await jobs.claim("due")).toBe(true);
      expect(await jobs.claim("due")).toBe(false);
      expect((await jobs.listRunning()).map(running => running.id)).toEqual(["due"]);
      expect(await jobs.listPending()).toEqual([]);

      expect(await jobs.finish("due", "done", "Announced.", new Date())).toBe(true);
      expect(await jobs.listRunning()).toEqual([]);
    });

    it("doesn't cancel a job once it's running, and doesn't finish one that never ran", async () => {
      await jobs.insert(job("racing", 5));
      expect(await jobs.finish("racing", "done", "Announced.", new Date())).toBe(false);

      await jobs.claim("racing");
      expect(await jobs.finish("racing", "cancelled", null, new Date())).toBe(false);
      expect((await jobs.listRunning()).map(running => running.id)).toEqual(["racing"]);
    });

    it("doesn't claim a cancelled job", async () => {
      await jobs.insert(job("gone", 5));
      await jobs.finish("gone", "cancelled", null, new Date());

      expect(await jobs.claim("gone")).toBe(false);
    });

    it("leaves existing jobs alone on a repeated import", async () => {
      await jobs.insert(job("kept", 5));
      await jobs.claim("kept");
      await jobs.finish("kept", "done", "Announced.", new Date());

      await jobs.insertIgnoringExisting([job("kept", 5), job("new", 10)]);

      const stored = await dataSource.getRepository(ScheduledJob).find({ order: { id: "ASC" } });
      expect(stored.map(row => [row.id, row.status])).toEqual([["kept", "done"], ["new", "pending"]]);
    });
  });

  describe("MorningRepository", () => {
    let morning: MorningRepository;
    const ALARM = Date.parse("2026-10-05T04:30:00.000Z");
    const GOOD_NIGHT = Date.parse("2026-10-04T20:00:00.000Z");
    const day = { localDate: "2026-10-05", alarmAt: ALARM, startedAt: ALARM + 20_000 };

    beforeEach(async () => {
      await dataSource.query("DELETE FROM morning_day");
      await dataSource.query("DELETE FROM morning_brief");
      morning = new MorningRepository(dataSource);
      await morning.saveArmedAlarm(null);
      await dataSource.query("UPDATE morning_state SET coffee_loaded = NULL, coffee_answered_at = NULL");
    });

    it("keeps the armed alarm to the millisecond, and clears it", async () => {
      await morning.saveArmedAlarm(ALARM + 123);
      expect(await morning.loadArmedAlarm()).toBe(ALARM + 123);

      await morning.saveArmedAlarm(null);
      expect(await morning.loadArmedAlarm()).toBeNull();
    });

    it("reserves a day once, copying the coffee answer into it and clearing it", async () => {
      await morning.saveCoffeeAnswer(true, GOOD_NIGHT);

      expect(await morning.reserveWake(day, GOOD_NIGHT - 1)).toEqual({ kind: "reserved", coffee: "loaded" });
      expect(await morning.reserveWake(day, GOOD_NIGHT - 1)).toEqual({ kind: "already_reserved" });

      const stored = await dataSource.getRepository(MorningDay).findOneByOrFail({ localDate: "2026-10-05" });
      expect(stored).toMatchObject({ status: "started", coffee: "loaded", lights: null });
      // Consumed: the next day can't brew from it.
      expect(await morning.reserveWake({ ...day, localDate: "2026-10-06" }, GOOD_NIGHT - 1)).toEqual({ kind: "reserved", coffee: "unknown" });
    });

    it("treats an answer older than the window as unknown", async () => {
      await morning.saveCoffeeAnswer(true, GOOD_NIGHT);
      expect(await morning.reserveWake(day, GOOD_NIGHT + 1)).toEqual({ kind: "reserved", coffee: "unknown" });
    });

    it("records each step and finishes the day", async () => {
      await morning.reserveWake(day, GOOD_NIGHT);
      await morning.recordWakeStep("2026-10-05", "lights", "done");
      await morning.recordWakeStep("2026-10-05", "coffeeMaker", "skipped");
      await morning.recordWakeStep("2026-10-05", "greeting", "failed");
      await morning.finishWake("2026-10-05", ALARM + 60_000);

      const stored = await dataSource.getRepository(MorningDay).findOneByOrFail({ localDate: "2026-10-05" });
      expect(stored).toMatchObject({ status: "done", lights: "done", coffeeMaker: "skipped", greeting: "failed" });
      expect(stored.finishedAt?.toISOString()).toBe(new Date(ALARM + 60_000).toISOString());
    });

    it("tells when the day's alarm woke the house", async () => {
      expect(await morning.loadWakeAlarm("2026-10-05")).toBeNull();
      await morning.reserveWake(day, GOOD_NIGHT);
      expect(await morning.loadWakeAlarm("2026-10-05")).toBe(ALARM);
    });

    it("reserves a day's brief once, keeps its text, and marks it delivered", async () => {
      const brief = { localDate: "2026-10-05", morningStartAt: ALARM, startSource: "alarm" as const, text: "Hyvää huomenta, look who's up.", reservedAt: ALARM + 900_000 };

      expect(await morning.reserveBrief(brief)).toEqual({ kind: "reserved" });
      expect(await morning.reserveBrief(brief)).toEqual({ kind: "already_reserved" });
      expect(await morning.hasBrief("2026-10-05")).toBe(true);
      expect(await morning.loadBriefText("2026-10-05")).toBe("Hyvää huomenta, look who's up.");

      await morning.markBriefDelivered("2026-10-05", ALARM + 960_000);
      const stored = await dataSource.getRepository(MorningBrief).findOneByOrFail({ localDate: "2026-10-05" });
      expect(stored).toMatchObject({ status: "delivered", startSource: "alarm" });
    });
  });
});