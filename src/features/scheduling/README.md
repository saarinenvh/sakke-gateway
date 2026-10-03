# Scheduling

Runs a stored tool call at a set time: after a duration ("in 10 minutes",
`source: "in"`) or at a clock time ("at 4 pm", `source: "at"`). A job is
stored before it is armed, so it survives a restart; only a call the tool marks
`schedulable` is accepted (today only `announce`). Finished jobs stay in the
table as history.

A spoken clock time is resolved in the configured timezone by `policy.ts`:
without am/pm an hour of 1-12 is its next upcoming reading, a time already
passed today is tomorrow's unless "today" was said, and a daylight saving
change moves a skipped time forward by the gap and takes the first of a
repeated one.

A job runs at most once. When it comes due it is first claimed in the
database (`pending` → `running`), then run, then recorded as `done` or
`failed`. If the claim can't be written, the job doesn't run then and stays
`pending`; a duplicated announcement is the worse failure than a missed one.

On startup the scheduler records any job still `running` as failed (it was
cut short, and isn't run again), then arms every pending job. One that came
due while the gateway was down is dropped if it was a duration job, and run
late if it was a clock-time job missed by at most 15 minutes. A late run gets
the time it was due as `scheduledFor`, so a late announcement says so.

## Entry points

| Export | Called by |
| --- | --- |
| `startScheduler(deps)` | `index.ts`, once the database is connected |
| `importLegacyTimers(...)` | `index.ts`, before the scheduler starts: moves `timers.json` from `STATE_DIR` into the database, once |
| `activeScheduler()` | `tools/schedule/schedule.ts`: schedule, cancel, list. `undefined` until the database is connected |
| `defaultAnnouncement(label)` | `tools/schedule/schedule.ts`, for a job given only a label |
| `resolveClockTime(time, now, timezone)` | `tools/schedule/schedule.ts`, for `when.at` |
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
| `policy.ts` | pure rules: resolving a spoken clock time, and whether a missed job runs late |
| `legacyTimers.ts` | the one-time import of `timers.json` |
| `db/ScheduledJob.entity.ts` | the `scheduled_job` row |
| `db/jobRepository.ts` | `JobRepository`, the only writer of `scheduled_job` |
