import { runAgent } from "../../agent/agent.js";
import { config } from "../../config.js";
import { callService, getState, getStateHistory } from "../../integrations/homeAssistant/client.js";
import { moduleLog } from "../../logger.js";
import { showSpeakingWhile } from "../display/displayState.js";
import type { CoachDeps } from "./coach.js";

// Separate from coach.ts so the coach doesn't import the agent and every tool.

// start_conversation returns after the satellite has spoken.
const START_CONVERSATION_TIMEOUT_MS = 30_000;

export const liveCoachDeps: CoachDeps = {
  now: () => Date.now(),
  readState: entityId => getState(entityId),
  readHistory: (entityId, since, until) => getStateHistory(entityId, since, until),

  // Throwaway conversation, and a profile without tools: writing a nag must
  // never act.
  writeNag: async request => {
    const { content } = await runAgent(request, `tidiness-${Date.now()}`, moduleLog(), { profile: "tidiness_nag" });
    return content;
  },

  startConversation: async (question, answerContext) => {
    await showSpeakingWhile(question, () => callService(
      "assist_satellite",
      "start_conversation",
      { entity_id: config.ha.satelliteEntityId, start_message: question, extra_system_prompt: answerContext },
      { timeoutMs: START_CONVERSATION_TIMEOUT_MS },
    ));
  },
};
