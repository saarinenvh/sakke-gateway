import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { recordGpuStatus, getGpuStatus } from "./gpuStatus.js";

// Only the two states the PC can observe; "unknown" is the gateway's own
// conclusion from a missing heartbeat, never something the PC reports.
const gpuStatusPushSchema = z.object({ state: z.enum(["available", "busy"]) });

export async function gpuStatusRoutes(app: FastifyInstance): Promise<void> {
  // Called by the dev PC's status-push service (scripts/gpu-router/status-service.ps1
  // in sakke-workspace) on every state change and on its periodic heartbeat.
  app.post("/internal/gpu-status", async (req, reply) => {
    const push = gpuStatusPushSchema.safeParse(req.body);
    if (!push.success) {
      return reply.code(400).send({ error: "state must be 'available' or 'busy'" });
    }

    recordGpuStatus(push.data);

    return { ok: true };
  });

  // Debug endpoint - inspect the current cached state, including computed
  // staleness (state comes back "unknown" once the last push is >45s old).
  app.get("/internal/gpu-status", async () => getGpuStatus());
}
