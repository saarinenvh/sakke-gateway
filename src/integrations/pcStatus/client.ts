import type { FastifyBaseLogger } from "fastify";

// The PC's status-service.ps1 (scripts/gpu-router/ in sakke-workspace), on the
// same host as PC_OLLAMA_BASE_URL but a separate process on its own port.
const PC_STATUS_SERVICE_PORT = 5055;
const UNLOAD_TIMEOUT_MS = 5000;

// POST /unload runs the same local Ollama unload the service already does for
// auto-detected busy, so how to unload Ollama lives in one place. Its body is
// ignored; only the status matters.
export async function unloadPcOllamaModels(pcOllamaUrl: string, log: FastifyBaseLogger): Promise<void> {
  const host = new URL(pcOllamaUrl).hostname;
  const url = `http://${host}:${PC_STATUS_SERVICE_PORT}/unload`;
  const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(UNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`PC status service /unload ${res.status}`);
  log.info({ url }, "Requested PC to unload Ollama VRAM");
}
