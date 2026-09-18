import type { FastifyInstance } from "fastify";
import { recordGpuStatus, getGpuStatus } from "../services/gpuStatus.js";

export async function gpuStatusRoutes(app: FastifyInstance): Promise<void> {
  // Called by the dev PC's status-push service (scripts/gpu-router/status-service.ps1
  // in sakke-workspace) on every state change and on its periodic heartbeat.
  app.post("/internal/gpu-status", async (req, reply) => {
    const body = req.body as { state?: string };

    if (body.state !== "available" && body.state !== "busy") {
      return reply.code(400).send({ error: "state must be 'available' or 'busy'" });
    }

    recordGpuStatus({ state: body.state });

    return { ok: true };
  });

  // Debug endpoint - inspect the current cached state, including computed
  // staleness (state comes back "unknown" once the last push is >45s old).
  app.get("/internal/gpu-status", async () => getGpuStatus());
}
