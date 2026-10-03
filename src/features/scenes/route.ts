import type { FastifyInstance } from "fastify";
import { designScene, applyScene, saveCurrentStateAsScene, InvalidScenePlanError } from "./scenes.js";
import { getLights } from "../../integrations/homeAssistant/registry.js";
import { saveSceneRequestSchema, sceneRequestSchema } from "./schema.js";

export async function sceneRoutes(app: FastifyInstance): Promise<void> {
  app.post("/scene", async (request, reply) => {
    const parsed = sceneRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "description must be a non-empty string, and apply a boolean" });
    }
    const { description, apply = false } = parsed.data;

    let plan;
    try {
      plan = await designScene(description);
    } catch (err) {
      if (err instanceof InvalidScenePlanError) {
        return reply.code(400).send({ ok: false, error: "invalid scene plan", issues: err.issues });
      }
      throw err;
    }
    app.log.info({ plan }, "Scene designed");

    if (!apply) {
      return reply.send({ ok: true, plan, applied: false });
    }

    const result = await applyScene(plan);
    return reply.send({
      ok: result.allSucceeded,
      plan,
      applied: true,
      all_succeeded: result.allSucceeded,
      any_succeeded: result.anySucceeded,
      outcomes: result.outcomes,
    });
  });

  app.post("/scene/save", async (request, reply) => {
    const parsed = saveSceneRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "name must be a non-empty string, and entity_ids a list of strings" });
    }
    const { name, entity_ids } = parsed.data;
    const entityIds = entity_ids ?? getLights().map(l => l.entity_id);
    const sceneId = await saveCurrentStateAsScene(name, entityIds);
    return reply.send({ ok: true, scene_id: sceneId });
  });
}
