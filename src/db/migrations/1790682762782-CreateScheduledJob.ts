import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateScheduledJob1790682762782 implements MigrationInterface {
  name = "CreateScheduledJob1790682762782";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE scheduled_job (
        id varchar(16) NOT NULL,
        run_at datetime(3) NOT NULL,
        source varchar(8) NOT NULL,
        tool varchar(64) NOT NULL,
        args text NOT NULL,
        label varchar(255) NOT NULL,
        status varchar(16) NOT NULL,
        created_at datetime(3) NOT NULL,
        finished_at datetime(3) NULL,
        result text NULL,
        PRIMARY KEY (id),
        INDEX idx_scheduled_job_status_run_at (status, run_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE scheduled_job`);
  }
}
