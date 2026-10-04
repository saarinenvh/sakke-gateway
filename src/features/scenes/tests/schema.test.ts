import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../../util/validation.js";
import {
  lightAttributesExample,
  lightAttributesSchema,
  saveSceneRequestExample,
  saveSceneRequestSchema,
  sceneRequestExample,
  sceneRequestSchema,
} from "../schema.js";

describe("scenes boundary schemas", () => {
  it("accept their examples", () => {
    expect(() => parseOrThrow(sceneRequestSchema, sceneRequestExample, "scene request example")).not.toThrow();
    expect(() => parseOrThrow(saveSceneRequestSchema, saveSceneRequestExample, "save scene request example")).not.toThrow();
    expect(() => parseOrThrow(lightAttributesSchema, lightAttributesExample, "light attributes example")).not.toThrow();
  });
});
