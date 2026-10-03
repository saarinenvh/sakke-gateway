import { z } from "zod";
import { parseOrThrow } from "../util/validation.js";
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

// Parses a tool call's arguments. A small model often sends `null` for a field
// it means to leave out, so a null counts as absent rather than invalid.
export function parseToolArgs<S extends z.ZodType>(schema: S, args: Record<string, unknown>, toolName: string): z.output<S> {
  const present = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null));
  return parseOrThrow(schema, present, `${toolName} tool arguments`);
}
