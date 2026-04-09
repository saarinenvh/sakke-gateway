# sakke-gateway

AI Gateway for the Sakke home assistant. Receives natural language commands via voice or text, runs a tool-calling LLM agent, and dispatches actions to Home Assistant.

## Features

- **Multi-turn agent** — conversation history per session, follow-up questions work naturally
- **Tool calling** — LLM decides which tools to use; results feed back into the conversation
- **Home control** — lights, scenes, switches, media via Home Assistant API
- **Routines** — user-defined HA scripts discovered automatically and runnable by voice
- **AI scene designer** — describe a mood, get a full lighting scene (OpenAI gpt-4o)
- **Shopping lists** — add/remove items with automatic store-layout ordering
- **Spotify** — search and play tracks, control playback
- **Weather** — current conditions and 6h forecast (Open-Meteo, no API key needed)
- **Web search** — SearXNG integration for current facts and news
- **Google Tasks** — query, add and complete personal tasks by voice
- **Google Calendar** — query today's or this week's events by voice
- **Morning routine** — "good morning" triggers lights (via HA script), daily summary and coffee maker prompt
- **Good night routine** — "good night" triggers lights off and TV switch via HA script

## Agent Tools

| Tool | Description |
|---|---|
| `control_home_assistant` | Lights, scenes, switches, media |
| `run_routine` | Run a user-defined HA script by name (routines) |
| `get_weather` | Current weather + 6h forecast (Espoo) |
| `web_search` | Web search via local SearXNG |
| `manage_list` | HA todo lists — shopping lists (store-ordered) and Google Tasks |
| `spotify` | Play/pause/next/previous/volume/search_and_play |
| `get_tasks` | Pending Google Tasks for today/tomorrow/this_week/next_week |
| `get_calendar` | Google Calendar events for today/tomorrow/this_week/next_week |

## Routes

| Method | Path | Description |
|---|---|---|
| POST | `/v1/chat/completions` | Main agent endpoint (OpenAI-compatible) |
| POST | `/command` | Single-turn command dispatch |
| POST | `/scene` | AI-powered scene designer |
| POST | `/scene/save` | Save current light state as a scene |
| GET | `/reminders/morning` | Morning greeting with tasks + calendar (for HA automations) |
| GET | `/reminders/check` | Pending tasks check — returns null if all done (for HA automations) |
| GET | `/health` | Healthcheck |

## Tech Stack

- **TypeScript 5** — Fastify HTTP server
- **Ollama** — local LLM inference (qwen3:8b)
- **OpenAI** — scene designer (gpt-4o)
- **Home Assistant** — smart home backend
- **Open-Meteo** — weather API
- **SearXNG** — local web search
- **Spotify Web API** — music search and playback
- **Google Tasks** — personal task management via HA todo integration
- **Google Calendar** — calendar events via HA calendar integration

## Setup

### Environment variables

```
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=qwen3:8b
HA_BASE_URL=http://host.docker.internal:8123
HA_TOKEN=your_ha_long_lived_token
HA_CONFIG_PATH=/ha-config
PORT=3100
TZ=Europe/Helsinki
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
OPENAI_API_KEY=your_openai_api_key
OPENAI_LIGHTING_MODEL=gpt-4o
TASKS_TODO=todo.sakke_tasks
CALENDAR_ENTITIES=calendar.sankaritour,calendar.saarinenvh_gmail_com,calendar.2026_dgpt_disc_golf_network_calendar
```

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

### Docker

```bash
docker build -t sakke-gateway .
docker run --env-file .env sakke-gateway
```

Deployed via [sakke-workspace](https://github.com/saarinenvh/sakke-workspace) as part of the full Docker Compose stack.
