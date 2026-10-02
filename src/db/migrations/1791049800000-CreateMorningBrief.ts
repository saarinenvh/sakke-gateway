import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMorningBrief1791049800000 implements MigrationInterface {
  name = "CreateMorningBrief1791049800000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE morning_brief (
        local_date varchar(10) NOT NULL,
        morning_start_at datetime(3) NOT NULL,
        start_source varchar(8) NOT NULL,
        status varchar(16) NOT NULL,
        text text NOT NULL,
        reserved_at datetime(3) NOT NULL,
        delivered_at datetime(3) NULL,
        PRIMARY KEY (local_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE morning_brief`);
  }
}
