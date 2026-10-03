# Scheduling

Runs a stored tool call at a set time. A job is stored before it is armed, so
it survives a restart; only a call the tool marks `schedulable` is accepted
(today only `announce`). On startup the scheduler arms every pending job and
drops a duration job ("in 10 minutes") that came due while the gateway was
down. Finished jobs stay in the table as history.

## Entry points

| Export | Called by |
| --- | --- |
| `startScheduler(deps)` | `index.ts`, once the database is connected |
| `importLegacyTimers(...)` | `index.ts`, before the scheduler starts: moves `timers.json` from `STATE_DIR` into the database, once |
| `activeScheduler()` | `tools/schedule/schedule.ts`: schedule, cancel, list. `undefined` until the database is connected |
| `defaultAnnouncement(label)` | `tools/schedule/schedule.ts`, for a job given only a label |
| `JobRunner`, `SchedulabilityCheck` | injected by `index.ts` from `tools/registry.ts` (`runScheduledCall`, `isSchedulable`) |

## Data

Owns the `scheduled_job` table (`db/ScheduledJob.entity.ts`), written only by
`db/jobRepository.ts`. The scheduler depends on the repository's shape
(`JobStore` in `scheduler.ts`), so tests use `tests/fixtures/fakeJobStore.ts`
at the repo root.

## Files

| File | Does |
| --- | --- |
| `scheduler.ts` | `Scheduler`: arm, run, record, cancel; the active instance |
| `legacyTimers.ts` | the one-time import of `timers.json` |
| `db/ScheduledJob.entity.ts` | the `scheduled_job` row |
| `db/jobRepository.ts` | `JobRepository`, the only writer of `scheduled_job` |
