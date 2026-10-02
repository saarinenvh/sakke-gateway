import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { recordGpuStatus, getGpuStatus, type GpuStatusPush } from "./gpuStatus.js";

// "unknown" is the gateway's own conclusion from a missing heartbeat, never
// something the PC reports.
const gpuStatusPushSchema = z.object({
  state: z.enum(["available", "busy"]),
  idleSeconds: z.number().finite().nonnegative().optional(),
}) satisfies z.ZodType<GpuStatusPush>;

export async function gpuStatusRoutes(app: FastifyInstance): Promise<void> {
  // Pushed by scripts/gpu-router/status-service.ps1 (sakke-workspace).
  app.post("/internal/gpu-status", async (req, reply) => {
    const push = gpuStatusPushSchema.safeParse(req.body);
    if (!push.success) {
      return reply.code(400).send({ error: "state must be 'available' or 'busy', and idleSeconds a non-negative number" });
    }

    recordGpuStatus(push.data);

    return { ok: true };
  });

  app.get("/internal/gpu-status", async () => getGpuStatus());
}
