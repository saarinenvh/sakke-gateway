import { runAgent } from "../../agent/agent.js";
import { config } from "../../config.js";
import { callService, getState } from "../../integrations/homeAssistant/client.js";
import { moduleLog } from "../../logger.js";
import type { CoachDeps } from "./coach.js";

// The coach's real dependencies. Kept apart from coach.ts so that module
// doesn't import the agent (and through it every tool) - index.ts wires this
// in, the same way it wires the timer announcer.

// start_conversation returns once the satellite has spoken; longer than the
// default so a long nag isn't cut off into an "uncertain" delivery.
const START_CONVERSATION_TIMEOUT_MS = 30_000;

export const liveCoachDeps: CoachDeps = {
  now: () => Date.now(),
  readState: entityId => getState(entityId),

  // A throwaway conversation, like the timer announcer's: writing the nag is
  // its own exchange, not part of whatever was last said. No tools: writing a
  // question must never start the vacuum by itself.
  writeNag: async request => {
    const { content } = await runAgent(request, `tidiness-${Date.now()}`, moduleLog(), { withholdTools: true });
    return content;
  },

  startConversation: async (question, answerContext) => {
    await callService(
      "assist_satellite",
      "start_conversation",
      { entity_id: config.ha.satelliteEntityId, start_message: question, extra_system_prompt: answerContext },
      { timeoutMs: START_CONVERSATION_TIMEOUT_MS },
    );
  },
};
