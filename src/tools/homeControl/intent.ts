import type { ControlHomeAssistantArgs } from "./schema.js";

// What the model asked for, plus `raw`, which the gateway adds: the call's
// arguments as sent, for scene_design to fall back on.
export type Intent = ControlHomeAssistantArgs & {
  raw: string;
};
