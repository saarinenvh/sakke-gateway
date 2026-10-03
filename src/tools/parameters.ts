import { z } from "zod";
import type { ToolDefinition } from "./types.js";

type ToolParameters = ToolDefinition["function"]["parameters"];

// Turns a tool's argument schema into the JSON Schema the model is shown, so
// the executor validates against exactly what the model was told. The input
// side is what the model sends; `$schema` is dropped because Ollama doesn't
// need it and it would only cost tokens.
export function toolParameters(schema: z.ZodObject): ToolParameters {
  const { properties = {}, required = [] } = z.toJSONSchema(schema, { io: "input" });
  return { type: "object", properties, required };
}
