import type { FastifyBaseLogger } from "fastify";

// The shape Ollama is sent. Typed rather than left as an object literal so a
// schema that's missing `required`, or misspells `properties`, fails at build
// time instead of being silently ignored by the model.
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

export interface ToolContext {
  log: FastifyBaseLogger;
  /** Tools that keep per-conversation state (Spotify's suggestions) key on this. */
  conversationId: string;
}

// A tool's schema and its implementation live together, in the feature that
// owns them. The registry only collects them; it knows nothing about any
// individual tool.
//
// execute() returns the string the model sees. It may throw: the registry
// turns a thrown error into a tool result, because a tool that throws past the
// agent loop takes down the whole conversation turn. A tool only catches for
// itself when failure is a normal outcome worth wording specifically - see
// get_context, where "not found" is an answer, not an error.
export interface Tool {
  definition: ToolDefinition;
  // Whether calling this again with identical arguments, in the same turn, is
  // safe - true for pure reads (get_device_state), false for anything with a
  // side effect (run_routine). Required, not defaulted: a new tool must
  // consciously pick a side, since the wrong default here is unsafe either way.
  repeatable: boolean;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> | string;
}
