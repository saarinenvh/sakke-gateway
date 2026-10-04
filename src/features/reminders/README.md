# Reminders

Reads the owner's pending tasks and calendar events from Home Assistant and
words them as short text: for a period (`today`, `tomorrow`, `this_week`,
`next_week`), or as the "still pending" nudge for today's unfinished tasks. A
task with no due date always counts as due.

## Entry points

| Route | Does |
| --- | --- |
| `GET /reminders/check` | today's pending tasks as `{ text, skip: false }`, or `{ text: null, skip: true }` when there are none (for HA automations) |

| Export | Called by |
| --- | --- |
| `getTasksText(period)`, `getCalendarText(period)` | `tools/reminders/tool.ts` (`get_tasks`, `get_calendar`), and `index.ts` for the morning brief |
| `getPendingReminder()` | `route.ts` |

## Data

None in the gateway. Tasks are read from the HA todo entity `config.ha.tasksTodo`
and events from `config.ha.calendarEntities`, through
`integrations/homeAssistant/`. Dates are in `config.timezone`.

## Files

| File | Does |
| --- | --- |
| `reminders.ts` | date ranges, task and event reads, the wording |
| `route.ts` | `/reminders/check` |
