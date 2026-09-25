import type { FastifyBaseLogger } from "fastify";
import { getGpuStatus } from "../gpu/gpuStatus.js";
import { config, type OllamaTargetConfig } from "../config.js";

// Per gpu_routing_design.md: the routing check happens once per conversation
// turn, not continuously mid-generation or per tool-call iteration within a
// turn - a game starting mid-response is an accepted small risk, not
// engineered around. "busy" and "unknown" (stale/no heartbeat yet, or no PC
// configured at all) both fail closed to the always-on server model -
// preferring the recoverable outcome over guessing wrong about whether the
// PC is actually reachable.
export function getOllamaTarget(log: FastifyBaseLogger): OllamaTargetConfig {
  // Read at call time, not captured at import - see config.ts.
  const { server, pc } = config.ollama;
  if (!pc) return server;

  const gpu = getGpuStatus();
  if (gpu.state === "available") {
    log.info({ gpuSource: gpu.source, gpuLastSeen: gpu.lastSeen }, "Routing to PC");
    return pc;
  }

  log.info({ gpuState: gpu.state, gpuStaleMs: gpu.staleMs }, "Routing to server");
  return server;
}
