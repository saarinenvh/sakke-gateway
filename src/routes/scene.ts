import type { FastifyInstance } from "fastify";
import { designScene, applyScene } from "../services/sceneDesigner.js";

interface SceneBody {
  description: string;
  apply?: boolean;
}

export async function sceneRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SceneBody }>("/scene", {
    schema: {
      body: {
        type: "object",
        required: ["description"],
        properties: {
          description: { type: "string", minLength: 1 },
          apply: { type: "boolean" },
        },
      },
    },
  }, async (request, reply) => {
    const { description, apply = false } = request.body;

    const plan = await designScene(description);
    app.log.info({ plan }, "Scene designed");

    if (apply) {
      await applyScene(plan);
    }

    return reply.send({ ok: true, plan, applied: apply });
  });
}
