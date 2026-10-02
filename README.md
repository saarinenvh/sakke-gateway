# sakke-gateway

AI Gateway for the Sakke home assistant. Receives natural language commands via voice or text, runs a tool-calling LLM agent, and dispatches actions to Home Assistant.

## Features

- **Multi-turn agent** — conversation history per session, follow-up questions work naturally
- **Tool calling** — the LLM picks the tools; results feed back into the conversation. 20 tools, each owned by the feature it belongs to
- **Follow-up classification** — a second, deliberately small model decides whether the next utterance is a continuation, an unrelated new request, or room noise. Noise gets silence: when Sakke has to guess, it fails quiet
- **GPU routing** — inference goes to the dev PC's GPU while it's idle and falls back to the server's own Ollama otherwise. Decided once per turn, and fails closed — "busy" and "unknown" both mean the server
- **Home control** — lights, scenes, switches, media via the Home Assistant API
- **Routines** — user-defined HA scripts discovered automatically and runnable by voice
- **TV control** — launch Netflix, YouTube, Spotify or DGN, send remote keycodes, type into a focused field
- **Device state queries** — ask if something is on, what's playing, which app the TV is in
- **AI scene designer** — describe a mood, get a full lighting scene (OpenAI gpt-4o). Reads its room layout and lighting notes from the wiki, so a lamp can move without a redeploy
- **Shopping lists** — add/remove items with automatic store-layout ordering
- **Spotify** — search by voice and pick from three spoken options; known personal playlists play immediately
- **Timers and reminders** — set, list and cancel; Sakke announces them aloud through the satellite when they're due, and they survive a restart
- **Robot vacuum** — "clean the house", stop, send it home, and status (state, battery, when the house was last cleaned)
- **Tidiness coach** — notices finished vacuum runs and, once the house has gone a week without one, asks out loud whether to clean. The asks get more frequent and meaner the longer it goes (day 7, day 9, then twice a day from day 10), and "yes" starts the vacuum. Off by default (`TIDINESS_ENABLED`); stays quiet when nobody is home, the satellite is busy, or it has been told to leave you alone
- **Morning wake-up** — when the phone's alarm rings, turns on the wake-up lights, starts the coffee maker if it was reported loaded at good night, and says good morning on the phone. Once a day, only with the owner home, and off by default (`MORNING_ENABLED`). Good night asks whether the coffee maker is loaded
- **Weather** — current conditions and 6h forecast (Open-Meteo, no API key needed)
- **Web search** — SearXNG with Brave as the backing engine
- **Google Tasks / Calendar** — query tasks and events by voice, via HA's todo and calendar integrations
- **Wiki context system** — personal knowledge base (Obsidian vault) mounted at `/wiki`; the index is always in the system prompt, `get_context` loads pages on demand, `create_knowledge` saves new notes silently
- **Conversation reset** — "lets start fresh" wipes history for that conversation

## Agent Tools

Each tool lives in `tools/<name>/`: its definition in `tool.ts`, its executor
next to it, and anything deeper in a service under `features/`. Which tools a
request may use is its profile's choice. How that fits together:
[docs/architecture/tools.md](docs/architecture/tools.md).

| Tool | Feature | Description |
|---|---|---|
| `control_home_assistant` | `tools/homeControl/` | Lights, scenes, switches, media |
| `web_search` | `tools/search/` | Web search via local SearXNG |
| `get_weather` | `tools/weather/` | Current weather + 6h forecast |
| `spotify` | `tools/spotify/` | Suggest / play / pause / next / previous / volume |
| `manage_list` | `tools/lists/` | HA todo lists — read, add, complete, remove, sort by store layout |
| `open_tv_app` | `tools/tv/` | Launch Netflix, YouTube, Spotify or DGN on the living room TV |
| `tv_remote_command` | `tools/tv/` | Send home / back / mute / search to the TV |
| `tv_send_text` | `tools/tv/` | Type into the TV's focused input field |
| `get_device_state` | `tools/homeControl/` | Live state and attributes of any HA entity |
| `run_routine` | `tools/homeControl/` | Run a user-defined HA script by name |
| `create_knowledge` | `tools/wiki/` | Save a note to `sakke-knowledge/` in the vault |
| `get_context` | `tools/wiki/` | Load a wiki knowledge page on demand |
| `get_tasks` | `tools/reminders/` | Pending Google Tasks for today / tomorrow / this_week / next_week |
| `schedule` | `tools/schedule/` | Set, cancel or list timers and reminders, stored in the gateway database |
| `refresh_home_data` | `tools/homeControl/` | Reload areas, scenes and routines from HA |
| `set_gaming_mode` | `tools/gpu/` | Stop routing inference to the PC's GPU, and free its VRAM |
| `get_calendar` | `tools/reminders/` | Google Calendar events for the same periods |
| `vacuum` | `tools/vacuum/` | Start / stop / dock / status, plus answers to a cleaning reminder |
| `coffee` | `tools/coffee/` | Record whether the coffee maker is loaded for the morning wake-up |
| `announce` | `tools/announce/` | Speak a message on the satellite in Sakke's words. In no profile: only the scheduler runs it |

## Routes

| Method | Path | Description |
|---|---|---|
| POST | `/v1/chat/completions` | Main agent endpoint (OpenAI-compatible). Optional `extra_system_prompt` is added to that turn - how a satellite-initiated question's answer knows what it answers |
| POST | `/scene` | AI-powered scene designer |
| POST | `/scene/save` | Save current light state as a scene |
| GET | `/reminders/check` | Pending tasks check — returns null if all done (for HA automations) |
| GET | `/display` | Tablet animation display (idle/listening/thinking/speaking orb) |
| GET | `/display/events` | SSE stream of state changes for the display |
| GET, POST | `/display/state` | Read or push a display state change |
| GET, POST | `/internal/gpu-status` | The PC pushes its GPU status and idle time here; GET reports what's currently known, including `lastInputAt` |
| GET | `/health` | Healthcheck |

## Architecture

How a request flows through the gateway, which module owns what, the tool
layers and the database: [docs/architecture/](docs/architecture/README.md).

## Where a fact should live

Three places, and the choice is not arbitrary:

- **The HA registry** — anything HA already knows (entity ids, areas, scene and script names). Discovered at startup, refreshable with `refresh_home_data`. Never hardcode it.
- **The wiki** — anything a human edits and Sakke reads (room layout, lighting notes, personal context). Changing it must not need a redeploy.
- **The prompt** — how to behave. Rules, tone, tool discipline. Not data.

## Tech Stack

- **TypeScript 5** — Fastify HTTP server
- **Ollama** — local LLM inference, model per `OLLAMA_MODEL`; a separate, smaller `OLLAMA_CLASSIFIER_MODEL` for follow-up classification
- **OpenAI** — scene designer (`OPENAI_LIGHTING_MODEL`, default gpt-4o)
- **Home Assistant** — smart home backend
- **MariaDB 10.11 + TypeORM** — the gateway's own database, for scheduled jobs; see [docs/architecture/data.md](docs/architecture/data.md)
- **Open-Meteo** — weather API
- **SearXNG** — local web search, Brave as the backing engine
- **Spotify Web API** — music search and playback
- **vitest** — unit and integration tests; the database tests run against MariaDB

## Setup

### Environment variables

`sakke-workspace/.env.example` is the documented source of truth, and CI checks
that every `${VAR}` in the compose file appears there. The gateway validates what
it reads at startup and logs anything missing or malformed rather than failing
later in a tool call.

Everything it reads goes through `src/config.ts`, which is the complete list:

| Group | Variables |
|---|---|
| Ollama | `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_NUM_CTX`, `OLLAMA_THINK`, `OLLAMA_KEEP_ALIVE` |
| Follow-up classifier | `OLLAMA_CLASSIFIER_BASE_URL`, `OLLAMA_CLASSIFIER_MODEL` |
| GPU routing (optional) | `PC_OLLAMA_BASE_URL`, `PC_OLLAMA_MODEL`, `PC_OLLAMA_NUM_CTX`, `PC_OLLAMA_THINK`, `PC_OLLAMA_KEEP_ALIVE` |
| Home Assistant | `HA_BASE_URL`, `HA_TOKEN`, `ASSIST_SATELLITE_ENTITY_ID` |
| Server | `PORT`, `TZ`, `STATE_DIR`, `WIKI_ROOT` |
| Features | `SEARXNG_URL`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `OPENAI_API_KEY`, `OPENAI_LIGHTING_MODEL`, `TASKS_TODO`, `CALENDAR_ENTITIES`, `WEATHER_LAT`, `WEATHER_LON`, `TV_WAKE_MS` |
| Gateway database | `GATEWAY_DB_HOST`, `GATEWAY_DB_PORT`, `GATEWAY_DB_NAME`, `GATEWAY_DB_USERNAME`, `GATEWAY_DB_PASSWORD` |
| Morning wake-up | `MORNING_ENABLED`, `MORNING_ALARM_SENSOR`, `MORNING_ALARM_PACKAGE`, `MORNING_PRESENCE_ENTITY_ID`, `MORNING_WAKE_SCRIPT`, `MORNING_COFFEE_SWITCH`, `MORNING_PHONE_NOTIFY_SERVICE`, `MORNING_ALARM_GRACE_MINUTES`, `MORNING_COFFEE_ANSWER_HOURS` |
| Tidiness coach | `TIDINESS_ENABLED`, `TIDINESS_VACUUM_ENTITY_ID`, `TIDINESS_PRESENCE_ENTITY_ID`, `TIDINESS_ASK_TIMES` (e.g. `10:00,18:00`), `TIDINESS_MIN_RUN_MINUTES`, `TIDINESS_SNOOZE_HOURS` |

Leaving `PC_OLLAMA_BASE_URL` unset disables GPU routing entirely and everything
runs on the server's own Ollama.

Leaving `GATEWAY_DB_HOST` unset leaves the gateway without its database, which
makes scheduling unavailable. With it set, the gateway connects in the
background, retrying every 30 s while MariaDB is unreachable, and runs any
pending schema migrations (`src/db/migrations/`) once it connects.

A blank value counts as unset — that distinction matters, and getting it wrong
once produced an HTTP 200 with a zero-byte body and a broken weather tool.

### Run locally

```bash
npm install
npm run dev:env   # once per checkout: copies .env.example to .env
npm run dev
```

`.env.example` holds working values for the dev machine (WSL): the Windows
host's Ollama at `172.31.0.1:11434`, `STATE_DIR=./data`, and the local MariaDB
with a dev-only password. None of them is a production value. `npm run dev:env`
keeps an existing `.env`; `npm run dev:env -- --force` replaces it.

`npm run dev` compiles with `tsc` and runs the result, the same way the image
does, so TypeORM gets the decorator metadata it needs. It doesn't watch for
changes; run it again after editing. Without a Home Assistant token the gateway
still starts and logs the missing `HA_TOKEN`.

The database is a local MariaDB 10.11, the server's version. Create the
gateway's database and its dev user once (`sudo mysql`):

```sql
CREATE DATABASE sakke_gateway CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'sakke_gateway'@'localhost' IDENTIFIED BY 'sakke-gateway-dev';
GRANT ALL PRIVILEGES ON sakke_gateway.* TO 'sakke_gateway'@'localhost';
```

The schema is created on the first start.

Talk to it the way Home Assistant does:

```bash
curl -s localhost:3100/v1/chat/completions -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"set a timer for 1 minute for the pasta"}]}'
```

### Build & run

```bash
npm run build
npm start
```

### Test

```bash
npm test
```

Unit tests sit next to the code as `*.test.ts`; integration tests live in
`tests/`, driving the real Fastify app through `app.inject()` against fake
Ollama and Home Assistant servers in `tests/fixtures/`. No test reaches the
network.

`tests/integration/database.test.ts` runs the migrations and entities against
a real MariaDB, and is skipped unless `TEST_DB_HOST` is set. CI provides a
throwaway `mariadb:10.11` container. Locally, use a separate test database,
because the test drops the gateway's tables first:

```sql
CREATE DATABASE sakke_gateway_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'sakke_gateway_test'@'localhost' IDENTIFIED BY 'sakke-gateway-test';
GRANT ALL PRIVILEGES ON sakke_gateway_test.* TO 'sakke_gateway_test'@'localhost';
```

```bash
TEST_DB_HOST=127.0.0.1 TEST_DB_PASSWORD=sakke-gateway-test npx vitest run tests/integration/database.test.ts
```

See `TEST_PLAN.md` in [sakke-workspace](https://github.com/saarinenvh/sakke-workspace)
for what is deliberately *not* tested, and why.

### Docker

```bash
docker build -t sakke-gateway .
docker run --env-file .env sakke-gateway
```

Normally deployed via [sakke-workspace](https://github.com/saarinenvh/sakke-workspace)
as part of the full Docker Compose stack:

```bash
s pull
s build sakke-gateway
```

`s build` recreates the container, which is what picks up a changed `.env`.
`s restart` does not.
