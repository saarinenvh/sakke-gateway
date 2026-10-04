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
  /** Set only when the scheduler runs the call: the time the job was due. */
  scheduledFor?: Date;
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
  // Whether calling this again with these exact arguments, in the same turn,
  // is safe - true for pure reads (get_device_state), false for anything with
  // a side effect (run_routine). Takes the call's arguments because a tool
  // that bundles several actions can mix both (manage_list's list_read vs.
  // list_add). Required, not defaulted: a new tool must consciously pick a
  // side, since the wrong default here is unsafe either way.
  repeatable(args: Record<string, unknown>): boolean;
  // Whether this call may be run later by the scheduler, with nobody there to
  // see it. Optional, and missing means no: unlike repeatable there is a safe
  // default, and a tool has to opt in to running unattended.
  schedulable?(args: Record<string, unknown>): boolean;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> | string;
}
