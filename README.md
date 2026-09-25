# sakke-gateway

AI Gateway for the Sakke home assistant. Receives natural language commands via voice or text, runs a tool-calling LLM agent, and dispatches actions to Home Assistant.

## Features

- **Multi-turn agent** — conversation history per session, follow-up questions work naturally
- **Tool calling** — the LLM picks the tools; results feed back into the conversation. 17 tools, each owned by the feature it belongs to
- **Follow-up classification** — a second, deliberately small model decides whether the next utterance is a continuation, an unrelated new request, or room noise. Noise gets silence: when Sakke has to guess, it fails quiet
- **GPU routing** — inference goes to the dev PC's GPU while it's idle and falls back to the server's own Ollama otherwise. Decided once per turn, and fails closed — "busy" and "unknown" both mean the server
- **Home control** — lights, scenes, switches, media via the Home Assistant API
- **Routines** — user-defined HA scripts discovered automatically and runnable by voice
- **TV control** — launch Netflix, YouTube, Spotify or DGN, send remote keycodes, type into a focused field
- **Device state queries** — ask if something is on, what's playing, which app the TV is in
- **AI scene designer** — describe a mood, get a full lighting scene (OpenAI gpt-4o). Reads its room layout and lighting notes from the wiki, so a lamp can move without a redeploy
- **Shopping lists** — add/remove items with automatic store-layout ordering
- **Spotify** — search by voice and pick from three spoken options; known personal playlists play immediately
- **Timers** — set, list and cancel voice timers; announced aloud through the satellite when they fire
- **Weather** — current conditions and 6h forecast (Open-Meteo, no API key needed)
- **Web search** — SearXNG with Brave as the backing engine
- **Google Tasks / Calendar** — query tasks and events by voice, via HA's todo and calendar integrations
- **Wiki context system** — personal knowledge base (Obsidian vault) mounted at `/wiki`; the index is always in the system prompt, `get_context` loads pages on demand, `create_knowledge` saves new notes silently
- **Conversation reset** — "lets start fresh" wipes history for that conversation

## Agent Tools

Each tool lives with its feature as `<feature>/tool.ts`, exporting its schema and
its implementation together. `tools/registry.ts` is the single list, and the only
place that logs a call, previews the result, or turns a thrown error into
something the model can react to.

| Tool | Feature | Description |
|---|---|---|
| `control_home_assistant` | `homeControl/` | Lights, scenes, switches, media |
| `web_search` | `search/` | Web search via local SearXNG |
| `get_weather` | `weather/` | Current weather + 6h forecast |
| `spotify` | `spotify/` | Suggest / play / pause / next / previous / volume |
| `manage_list` | `lists/` | HA todo lists — read, add, complete, remove, sort by store layout |
| `open_tv_app` | `tv/` | Launch Netflix, YouTube, Spotify or DGN on the living room TV |
| `tv_remote_command` | `tv/` | Send home / back / mute / search to the TV |
| `tv_send_text` | `tv/` | Type into the TV's focused input field |
| `get_device_state` | `homeControl/` | Live state and attributes of any HA entity |
| `run_routine` | `homeControl/` | Run a user-defined HA script by name |
| `create_knowledge` | `wiki/` | Save a note to `sakke-knowledge/` in the vault |
| `get_context` | `wiki/` | Load a wiki knowledge page on demand |
| `get_tasks` | `reminders/` | Pending Google Tasks for today / tomorrow / this_week / next_week |
| `timer` | `timers/` | Set, cancel or list voice timers |
| `refresh_home_data` | `homeControl/` | Reload areas, scenes and routines from HA |
| `set_gaming_mode` | `gpu/` | Stop routing inference to the PC's GPU, and free its VRAM |
| `get_calendar` | `reminders/` | Google Calendar events for the same periods |

## Routes

| Method | Path | Description |
|---|---|---|
| POST | `/v1/chat/completions` | Main agent endpoint (OpenAI-compatible) |
| POST | `/scene` | AI-powered scene designer |
| POST | `/scene/save` | Save current light state as a scene |
| GET | `/reminders/morning` | Morning greeting with tasks + calendar (for HA automations) |
| GET | `/reminders/check` | Pending tasks check — returns null if all done (for HA automations) |
| GET | `/display` | Tablet animation display (idle/listening/thinking/speaking orb) |
| GET | `/display/events` | SSE stream of state changes for the display |
| GET, POST | `/display/state` | Read or push a display state change |
| GET, POST | `/internal/gpu-status` | The PC pushes its GPU status here; GET reports what's currently known |
| GET | `/health` | Healthcheck |

## Layout

`src/` is organised by feature, not by technical layer. A feature owns its logic,
its tool, and the fragment of the system prompt that explains it.

```
src/
├── config.ts             # all configuration, read once, validated, problems logged at startup
├── app.ts                # buildApp() — routes only, so tests can inject
├── index.ts              # composition root: wiring, then listen
├── agent/
│   ├── agent.ts          # the tool-calling loop, and nothing else
│   ├── conversationStore.ts  # history, pruning, context-budget trimming
│   ├── ollamaRouter.ts   # which Ollama this turn goes to
│   ├── continuationCheck.ts  # the follow-up classifier
│   ├── systemPrompt.ts   # concatenates the per-feature fragments
│   ├── voiceText.ts      # strips anything that shouldn't be spoken aloud
│   └── prompts/          # persona.md, toolDiscipline.md
├── tools/
│   ├── registry.ts       # the one tool list, and the one try/catch
│   └── types.ts
├── integrations/homeAssistant/
│   ├── client.ts         # the only place that talks HTTP to HA
│   └── registry.ts       # areas, scenes, scripts, entities
├── homeControl/  lists/  spotify/  weather/  search/  reminders/
├── timers/  tv/  wiki/  scenes/  gpu/  display/
└── …                     # each with feature.ts, tool.ts, prompt.ts as needed
```

Every feature's `prompt.ts` is concatenated into the system prompt in a fixed
order by `agent/systemPrompt.ts`. Adding a feature means adding a folder, not
editing four shared files.

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
- **Open-Meteo** — weather API
- **SearXNG** — local web search, Brave as the backing engine
- **Spotify Web API** — music search and playback
- **vitest** — 190 tests in under a second

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

Leaving `PC_OLLAMA_BASE_URL` unset disables GPU routing entirely and everything
runs on the server's own Ollama.

A blank value counts as unset — that distinction matters, and getting it wrong
once produced an HTTP 200 with a zero-byte body and a broken weather tool.

### Run locally

```bash
npm install
npm run dev
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

190 tests, ~0.8s. Unit tests sit next to the code as `*.test.ts`; integration
tests live in `tests/`, driving the real Fastify app through `app.inject()`
against fake Ollama and Home Assistant servers in `tests/fixtures/`. No test
reaches the network.

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
