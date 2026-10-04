import { z } from "zod";
import type { GpuStatusPush } from "./gpu.js";

// PC status service → gateway, POST /internal/gpu-status.
// Pushed by scripts/gpu-router/status-service.ps1 (sakke-workspace).

export const gpuStatusPushExample = {
  state: "available",
  heartbeat: true, // ignored: a heartbeat and a state change are handled the same
  timestamp: "2026-10-03T07:42:00.0000000+03:00", // ignored: the gateway stamps arrival time
  idleSeconds: 412, // missing when the PC can't read its idle time
};

// Far beyond any real idle time, and keeps the derived lastInputAt a valid date.
const MAX_IDLE_SECONDS = 10 * 365 * 24 * 3600;

// "unknown" is the gateway's own conclusion from a missing heartbeat, never
// something the PC reports.
export const gpuStatusPushSchema = z.object({
  state: z.enum(["available", "busy"]),
  idleSeconds: z.number().nonnegative().max(MAX_IDLE_SECONDS).optional(),
}) satisfies z.ZodType<GpuStatusPush>;
