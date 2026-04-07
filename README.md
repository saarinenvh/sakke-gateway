# sakke-gateway

AI Gateway for the Sakke home assistant. Receives natural language commands via voice or text, runs a tool-calling LLM agent, and dispatches actions to Home Assistant.

## Features

- **Multi-turn agent** — conversation history per session, follow-up questions work naturally
- **Tool calling** — LLM decides which tools to use; results feed back into the conversation
- **Home control** — lights, scenes, switches, media, routines via Home Assistant API
- **AI scene designer** — describe a mood, get a full lighting scene
- **Shopping lists** — add/remove items with automatic store-layout ordering
- **Spotify** — search and play tracks, control playback
- **Weather** — current conditions and 6h forecast (Open-Meteo, no API key needed)
- **Web search** — SearXNG integration for current facts and news
- **Finnish** — personality, responses, and STT all in Finnish

## Agent Tools

| Tool | Description |
|---|---|
| `control_home_assistant` | Lights, scenes, switches, media, routines |
| `get_weather` | Current weather + 6h forecast (Espoo) |
| `web_search` | Web search via local SearXNG |
| `manage_list` | HA Local To-do lists with store-ordered grocery sorting |
| `spotify` | Play/pause/next/previous/volume/search_and_play |

## Routes

| Method | Path | Description |
|---|---|---|
| POST | `/v1/chat/completions` | Main agent endpoint (OpenAI-compatible) |
| POST | `/command` | Single-turn command dispatch |
| POST | `/scene` | AI-powered scene designer |
| POST | `/scene/save` | Save current light state as a scene |
| GET | `/health` | Healthcheck |

## Tech Stack

- **TypeScript 5** — Fastify HTTP server
- **Ollama** — local LLM inference (qwen3:8b)
- **Home Assistant** — smart home backend
- **Open-Meteo** — weather API
- **SearXNG** — local web search
- **Spotify Web API** — music search and playback

## Setup

### Environment variables

```
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=qwen3:8b
HA_BASE_URL=http://host.docker.internal:8123
HA_TOKEN=your_ha_long_lived_token
HA_CONFIG_PATH=/ha-config
PORT=3100
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
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
