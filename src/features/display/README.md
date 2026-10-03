# Display

Shows what Sakke is doing (`idle`, `listening`, `thinking`, `speaking`) on a
browser page: an animated orb that follows the state over server-sent events.
The state is kept in memory; Home Assistant pushes voice pipeline changes, and
the gateway sets it itself while it thinks and speaks.

## Entry points

| Route | Does |
| --- | --- |
| `GET /display` | the page |
| `GET /display/events` | SSE stream: the current state on connect, then every change |
| `POST /display/state` | an HA automation reports a voice pipeline state (`{ state }`) |
| `GET /display/state` | the current state |

| Export | Called by |
| --- | --- |
| `broadcastState`, `speakingDurationMs` | `agent/agent.ts`, during a conversation turn |
| `showSpeakingWhile(text, speak)` | `features/announcements/announcer.ts`, `features/tidiness/tidiness.ts` |

`showSpeakingWhile` shows `speaking` for roughly as long as the text takes to
say, and goes back to `idle` if speaking fails, unless the state has changed
since.

## Data

Memory only; lost on restart.

## Files

| File | Does |
| --- | --- |
| `displayState.ts` | the current state, SSE clients, `broadcastState`, `showSpeakingWhile` |
| `route.ts` | the routes, and the page's HTML and script |
| `schema.ts` | the `POST /display/state` body |
