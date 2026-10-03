import { describe, it } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import {
  lightAttributesExample,
  lightAttributesSchema,
  saveSceneRequestExample,
  saveSceneRequestSchema,
  sceneRequestExample,
  sceneRequestSchema,
} from "./schema.js";

describe("scenes boundary schemas", () => {
  it("accept their examples", () => {
    parseOrThrow(sceneRequestSchema, sceneRequestExample, "scene request example");
    parseOrThrow(saveSceneRequestSchema, saveSceneRequestExample, "save scene request example");
    parseOrThrow(lightAttributesSchema, lightAttributesExample, "light attributes example");
  });
});
