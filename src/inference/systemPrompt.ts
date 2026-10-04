// Sakke's system prompt, as the agent composes it. Composing it needs every
// tool's prompt section, and tools sit above inference/, so index.ts wires the
// builder in at startup instead of this module importing it.
export type SystemPromptBuilder = () => Promise<string>;

let buildSystemPrompt: SystemPromptBuilder = async () => {
  throw new Error("no system prompt builder configured");
};

export function setSystemPromptBuilder(builder: SystemPromptBuilder): void {
  buildSystemPrompt = builder;
}

export function sakkeSystemPrompt(): Promise<string> {
  return buildSystemPrompt();
}
