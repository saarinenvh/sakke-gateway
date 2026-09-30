# Data

What the gateway stores, where, and who may change it.

| Data | Where | Survives a restart |
| --- | --- | --- |
| Scheduled jobs and their history | gateway database, `scheduled_job` | yes |
| Tidiness coach state | `tidiness.json` in `STATE_DIR` | yes |
| Conversations | memory (`agent/conversationStore.ts`) | no, by design |
| GPU status, display state | memory | no; reported again |

`tidiness.json` moves into the database in a follow-up ticket.

## The gateway database

The gateway has its own database, `sakke_gateway`, on the MariaDB 10.11 server
that sakariheitaja also uses, with its own user granted only that database.
Neither service can read the other's data.

- **Access:** TypeORM 1.x, `type: "mariadb"`, on the `mysql2` driver.
- **Times** are stored as UTC `DATETIME(3)` (`timezone: "Z"`); local time only
  appears when a time is resolved or spoken.
- **Charset** `utf8mb4`, since text can be Finnish.
- **Idle connections:** the pool keeps none (`mysql2` `maxIdle: 0`), so every
  connection is closed after 60 s idle.

Why these choices:

- *MariaDB, not SQLite.* `node:sqlite` was the first choice, but TypeORM has no
  driver for it; its only Node SQLite driver is `better-sqlite3`, a native
  module the Alpine image would have to build. MariaDB was already running,
  and a second database there adds no infrastructure.
- *A database of its own, not tables in the bot's.* Each service's data stays
  its own, and credentials grant only what a service uses.
- *`maxIdle: 0`, not keepalive.* MariaDB closes a connection idle longer than
  its `wait_timeout` (8 h by default), counting time between commands, so TCP
  keepalive doesn't prevent it. The scheduler can sit idle overnight; by not
  keeping idle connections, its 11:00 job always gets a fresh one.

## Startup and outages

`db/database.ts` connects in the background at startup and retries every 30 s
until MariaDB answers. The gateway serves requests meanwhile: voice and every
tool that doesn't need the database keep working, and what does need it reports
itself unavailable. With `GATEWAY_DB_HOST` unset there is no database at all,
reported as a configuration problem at startup.

## Who owns a table

`src/db/` is infrastructure only: the connection (`dataSource.ts`), the retry
(`database.ts`), the list of entities and the migrations. It holds no feature's
tables or queries.

- **Every table has exactly one owning module.** It defines the entity
  (`<Name>.entity.ts`) and a repository, and is the only code that writes the
  table. `features/scheduling/` owns `scheduled_job`.
- **Other features read through the owner's repository**, never the table
  directly, so the owner's rules (for example: only a pending job can be
  finished) hold for every caller.
- **A concept several features use, with no single owner**, gets a module of
  its own rather than living in one of its users.
- **Across modules, rows refer to each other by id**, not TypeORM relations,
  so one module's schema can change without breaking another. Relations inside
  a module are fine.
- **The entity is the row's type.** There is no second type for the same row.
  Code that needs to swap the storage (the scheduler, in tests) depends on the
  repository's shape (`Pick<JobRepository, …>`), not on a parallel interface.

The one exception to plain TypeORM typing: its insert types can't express a
JSON column holding arbitrary tool arguments, so `jobRepository.ts` has a
single commented type assertion at the boundary.

Why one owner: once a second module writes a table, nothing says whose rules
apply, and they drift. The bot keeps all its tables in one `src/db/`, which
works for one application; the gateway's features (scheduling, tidiness, later
goals and the portal) each own their data.

## Migrations

- Schema changes are migration files in `src/db/migrations/`, one ordered
  history for the whole database, written as plain SQL so the change is
  readable in review.
- They run on connect (`migrationsRun: true`). `synchronize` is off: the schema
  never follows the entity classes on its own.
- A new migration is added to the list in `db/dataSource.ts`, as is a new
  entity.

## Development and tests

- **Locally**, the gateway uses a MariaDB on the dev machine with the dev-only
  values in `.env.example` (`npm run dev:env`). The SQL to create the database
  and its user is in the README.
- **Most tests need no database:** the scheduler is tested with an in-memory
  store (`tests/fixtures/fakeJobStore.ts`).
- **`tests/integration/database.test.ts`** runs the migrations and the
  repositories against a real MariaDB: a throwaway `mariadb:10.11` container in
  CI, or a local `sakke_gateway_test` database. It drops the gateway's tables
  first, and is skipped unless `TEST_DB_HOST` is set. Every test that needs
  the database goes in that one file, since test files run in parallel.
