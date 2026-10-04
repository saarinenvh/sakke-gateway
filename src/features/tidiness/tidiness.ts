import { config } from "../../config.js";
import { callService, getState, getStateHistory } from "../../integrations/homeAssistant/client.js";
import { moduleLog } from "../../logger.js";
import { showSpeakingWhile } from "../display/display.js";
import { writeText } from "../../inference/writeText.js";
import { startTidinessCoach, type CoachDeps } from "./coach.js";
import { restoreTidinessState } from "./store.js";

// start_conversation returns after the satellite has spoken.
const START_CONVERSATION_TIMEOUT_MS = 30_000;

// State first, so the first tick knows what was already asked before a restart.
export async function startTidiness(): Promise<void> {
  await restoreTidinessState();
  startTidinessCoach(liveCoachDeps);
}

const liveCoachDeps: CoachDeps = {
  now: () => Date.now(),
  readState: entityId => getState(entityId),
  readHistory: (entityId, since, until) => getStateHistory(entityId, since, until),

  // A profile without tools: writing a nag must never act.
  writeNag: request => writeText("tidiness_nag", request, moduleLog()),

  startConversation: async (question, answerContext) => {
    await showSpeakingWhile(question, () => callService(
      "assist_satellite",
      "start_conversation",
      { entity_id: config.ha.satelliteEntityId, start_message: question, extra_system_prompt: answerContext },
      { timeoutMs: START_CONVERSATION_TIMEOUT_MS },
    ));
  },
};
