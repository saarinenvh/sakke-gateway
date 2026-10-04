import type { Tool } from "../types.js";
import { setManualOverride, clearManualOverride } from "../../features/gpu/gpu.js";
import { config } from "../../config.js";
import { unloadPcOllamaModels } from "../../integrations/pcStatus/client.js";
import { toolParameters, parseToolArgs } from "../parameters.js";
import { setGamingModeArgsSchema } from "./schema.js";

export const setGamingModeTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "set_gaming_mode",
      description: "Manually override whether the gaming PC's GPU is available for Sakke to use, instead of waiting for automatic detection. Use 'gaming' when the user says things like 'I'm gaming', 'I'm playing a game', 'leave my PC alone', 'stay off my GPU'. Use 'free' when they say the opposite - 'I'm free', 'done gaming', 'you can use my PC again' - which goes back to automatic detection rather than forcing availability.",
      parameters: toolParameters(setGamingModeArgsSchema),
    },
  },
  repeatable: () => false,
  execute: async (args, { log }) => {
    const { mode } = parseToolArgs(setGamingModeArgsSchema, args, "set_gaming_mode");
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
    clearManualOverride();
    return "Okay, I'll go back to automatically checking if your PC's GPU is free.";
  },
};
