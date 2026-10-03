# Tidiness coach

Notices finished robot vacuum runs, and once the house has gone a week without
one, asks out loud on the satellite (`assist_satellite.start_conversation`)
whether to clean. Asks come more often as the days pass (`policy.ts`), at
the configured ask times, and get meaner with the days and with every "no".
It stays quiet when the owner isn't home, the satellite is busy or
unavailable, or the reminders are snoozed. Off by default (`TIDINESS_ENABLED`),
though finished runs are tracked either way.

## Entry points

| Export | Called by |
| --- | --- |
| `restoreTidinessState()`, then `startTidinessCoach(liveCoachDeps)` | `index.ts` at startup; the coach ticks periodically |
| `runVacuumAction` | `tools/vacuum/vacuum.ts`: move the vacuum, report its status or the last clean, "mark cleaned", answer a nag, snooze |
| `VACUUM_ACTIONS`, `READ_ONLY_VACUUM_ACTIONS` | `tools/vacuum/schema.ts` (the action argument), `tools/vacuum/tool.ts` (`repeatable`) |
| `findSpokenVacuumName` | `tools/vacuum/prompt.ts` |

## Data

No database table. Its state (last clean, the run in progress, the snooze, and
its recent nags) is kept in memory and written to `tidiness.json`
in `STATE_DIR` on every change.

## Files

| File | Does |
| --- | --- |
| `coach.ts` | the tick: track vacuum runs, decide, ask |
| `policy.ts` | pure rules: the ask schedule, tone, run detection, which nag an answer belongs to |
| `prompts.ts` | the request that words a nag, and the context its answer is read with |
| `store.ts` | the state and `tidiness.json` |
| `vacuum.ts` | which vacuum, and the name the owner gives it |
| `vacuumActions.ts` | the vacuum tool's actions: drive the vacuum, describe it and the last clean, record answers to a nag |
| `liveDeps.ts` | the real Home Assistant, agent and satellite calls behind `CoachDeps` |
