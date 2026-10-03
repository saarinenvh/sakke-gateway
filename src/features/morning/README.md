# Morning

Two morning routines, both off by default (`MORNING_ENABLED`) and run only with
the owner home.

- **Wake-up** (`wakeUp.ts`): when the phone's alarm rings, turns on the
  wake-up lights (`MORNING_WAKE_SCRIPT`), starts the coffee maker if it was
  reported loaded at good night, and says good morning as a spoken phone
  notification. Once per local day.
- **Brief** (`brief.ts`): on the first PC input a while after the morning
  started (the alarm, else the watch's wake time) and before a cut-off time,
  speaks a summary of today's calendar, tasks and weather on the satellite.
  Once per local day.

Both are periodic ticks. The wake-up records each step's outcome, and a
failed step doesn't stop the next one.

## Entry points

| Export | Called by |
| --- | --- |
| `startMorning(repo)` (`morning.ts`) | `index.ts`, once the database is connected: sets the coffee answer store and starts both ticks with their real dependencies |
| `recordCoffeeAnswer(loaded, now)` | `tools/coffee/tool.ts`, when the owner answers good night's coffee question |

## Data

Owns three tables, written only by `db/morningRepository.ts`:

| Table | Entity | Holds |
| --- | --- | --- |
| `morning_state` | `db/MorningState.entity.ts` | one row: the alarm being watched and the last coffee answer |
| `morning_day` | `db/MorningDay.entity.ts` | each day's wake-up and the outcome of each step |
| `morning_brief` | `db/MorningBrief.entity.ts` | each day's brief and whether it was spoken |

A day's row is created before its first action, so a day is never woken or
briefed twice.

## Files

| File | Does |
| --- | --- |
| `morning.ts` | the main entry: starts both ticks, and builds their real dependencies (Home Assistant, `inference/writeText`, the phone, the satellite, the calendar, task and weather readers) |
| `wakeUp.ts` | the wake-up tick |
| `brief.ts` | the brief tick |
| `policy.ts` | pure rules: the due alarm, coffee state, the morning's start, when the brief is due |
| `prompts.ts` | the greeting and brief requests, and their fallbacks |
| `coffee.ts` | records the coffee answer |
| `db/` | the three entities and `MorningRepository` |
| `tests/fakeMorningStore.ts` | an in-memory `MorningRepository` for the tests |
