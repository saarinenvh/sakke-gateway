import type { FastifyBaseLogger } from "fastify";
import type { Tool } from "../tools/types.js";
import { setManualOverride, clearManualOverride } from "./gpuStatus.js";
import { config } from "../config.js";

// status-service.ps1's default port - see scripts/gpu-router/ in sakke-workspace.
const PC_STATUS_SERVICE_PORT = 5055;

// Asks the PC's own status-service.ps1 to free Ollama's VRAM (its POST
// /unload, stateless, just runs the same local unload it already does for
// auto-detected busy) rather than duplicating that trick here - the actual
// "how" of unloading Ollama should live in exactly one place. Same host as
// PC_OLLAMA_BASE_URL, different port - the status service and Ollama are
// separate processes on the PC.
async function unloadPcOllamaModels(pcOllamaUrl: string, log: FastifyBaseLogger): Promise<void> {
  const host = new URL(pcOllamaUrl).hostname;
  const url = `http://${host}:${PC_STATUS_SERVICE_PORT}/unload`;
  const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`PC status service /unload ${res.status}`);
  log.info({ url }, "Requested PC to unload Ollama VRAM");
}

export const setGamingModeTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "set_gaming_mode",
      description: "Manually override whether the gaming PC's GPU is available for Sakke to use, instead of waiting for automatic detection. Use 'gaming' when the user says things like 'I'm gaming', 'I'm playing a game', 'leave my PC alone', 'stay off my GPU'. Use 'free' when they say the opposite - 'I'm free', 'done gaming', 'you can use my PC again' - which goes back to automatic detection rather than forcing availability.",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["gaming", "free"],
            description: "'gaming' immediately marks the PC's GPU busy so Sakke stops routing there. 'free' clears the override and resumes automatic detection.",
          },
        },
        required: ["mode"],
      },
    },
  },
  execute: async (args, { log }) => {
    const mode = args.mode as string;
    const pcOllamaUrl = config.ollama.pc?.baseUrl;
    if (!pcOllamaUrl) return "GPU routing to your PC isn't configured, so there's nothing to override.";

    if (mode === "gaming") {
      // The override itself is purely local state - it can't fail. Freeing
      // VRAM on the PC is best-effort on top of it: if the PC is asleep/
      // unreachable, that's fine, there's nothing loaded there to free.
      setManualOverride("busy");
      try {
        await unloadPcOllamaModels(pcOllamaUrl, log);
      } catch (err: any) {
        log.warn({ err: err.message }, "Couldn't reach PC to unload VRAM");
      }
      return "Got it, I'll leave your PC's GPU alone.";
    }
    if (mode === "free") {
      clearManualOverride();
      return "Okay, I'll go back to automatically checking if your PC's GPU is free.";
    }
    return `Unknown gaming mode: ${mode}`;
  },
};
