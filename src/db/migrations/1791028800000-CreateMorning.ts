import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMorning1791028800000 implements MigrationInterface {
  name = "CreateMorning1791028800000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE morning_state (
        id tinyint NOT NULL,
        armed_alarm_at datetime(3) NULL,
        coffee_loaded tinyint(1) NULL,
        coffee_answered_at datetime(3) NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`INSERT INTO morning_state (id) VALUES (1)`);
    await queryRunner.query(`
      CREATE TABLE morning_day (
        local_date varchar(10) NOT NULL,
        alarm_at datetime(3) NOT NULL,
        status varchar(16) NOT NULL,
        coffee varchar(16) NOT NULL,
        lights varchar(16) NULL,
        coffee_maker varchar(16) NULL,
        greeting varchar(16) NULL,
        started_at datetime(3) NOT NULL,
        finished_at datetime(3) NULL,
        PRIMARY KEY (local_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE morning_day`);
    await queryRunner.query(`DROP TABLE morning_state`);
  }
}
