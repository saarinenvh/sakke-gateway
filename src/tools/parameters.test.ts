import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ValidationError } from "../util/validation.js";
import { parseToolArgs, toolParameters } from "./parameters.js";

const argsSchema = z.object({
  action: z.enum(["on", "off"]).describe("What to do"),
  level: z.number().optional(),
});

describe("toolParameters", () => {
  it("shows the model the schema's fields, descriptions and required list", () => {
    expect(toolParameters(argsSchema)).toEqual({
      type: "object",
      properties: {
        action: { type: "string", enum: ["on", "off"], description: "What to do" },
        level: { type: "number" },
      },
      required: ["action"],
    });
  });
});

describe("parseToolArgs", () => {
  it("treats a null as a left-out field", () => {
    expect(parseToolArgs(argsSchema, { action: "on", level: null }, "test")).toEqual({ action: "on" });
  });

  it("rejects arguments that don't match, naming the tool", () => {
    expect(() => parseToolArgs(argsSchema, { action: "sideways" }, "test")).toThrow(ValidationError);
    expect(() => parseToolArgs(argsSchema, { action: "sideways" }, "test")).toThrow(/test tool arguments/);
  });
});
