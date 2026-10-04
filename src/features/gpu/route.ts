import type { FastifyInstance } from "fastify";
import { recordGpuStatus, getGpuStatus } from "./gpu.js";
import { gpuStatusPushSchema } from "./schema.js";

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
