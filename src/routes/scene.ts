import type { FastifyInstance } from "fastify";
import { designScene, applyScene, saveCurrentStateAsScene } from "../services/sceneDesigner.js";
import { getLights } from "../services/entityRegistry.js";

interface SceneBody {
  description: string;
  apply?: boolean;
}

interface SaveSceneBody {
  name: string;
  entity_ids?: string[];
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

  app.post<{ Body: SaveSceneBody }>("/scene/save", {
    schema: {
      body: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          entity_ids: { type: "array", items: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    const { name, entity_ids } = request.body;
    const entityIds = entity_ids ?? getLights().map(l => l.entity_id);
    const sceneId = await saveCurrentStateAsScene(name, entityIds);
    return reply.send({ ok: true, scene_id: sceneId });
  });
}
