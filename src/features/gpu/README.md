# GPU status

Keeps the dev PC's GPU status, pushed by the PC's status service
(`scripts/gpu-router/status-service.ps1` in sakke-workspace), and decides
whether the PC is `available`, `busy` or `unknown`. Without a recent heartbeat
the state is `unknown`, and callers fall back to the server. A manual
override can force `busy` or `available` for a while (a default set in `gpu.ts`).

## Entry points

| Route | Does |
| --- | --- |
| `POST /internal/gpu-status` | the PC reports `{ state, idleSeconds? }` |
| `GET /internal/gpu-status` | the current status, with its source and staleness |

| Export | Called by |
| --- | --- |
| `getGpuStatus()` | `inference/ollamaRouter.ts`, to pick the Ollama for a request |
| `setManualOverride`, `clearManualOverride` | `tools/gpu/tool.ts`, the model's GPU tool |
| `getPcInput()` | `features/morning/morning.ts`, for the morning brief's "first PC input" |

## Data

Memory only; the PC reports again after a restart.

## Files

| File | Does |
| --- | --- |
| `gpu.ts` | the last push, the manual override, `getGpuStatus`, `getPcInput` |
| `route.ts` | the two routes |
| `schema.ts` | the PC's push body |
