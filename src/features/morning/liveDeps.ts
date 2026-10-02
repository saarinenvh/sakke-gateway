import { runAgent } from "../../agent/agent.js";
import { config } from "../../config.js";
import { callService, getState } from "../../integrations/homeAssistant/client.js";
import { speakOnPhone } from "../../integrations/homeAssistant/phone.js";
import { moduleLog } from "../../logger.js";
import type { MorningDeps } from "./coach.js";
import type { MorningRepository } from "./morningRepository.js";

// Separate from coach.ts so the coach doesn't import the agent and every tool.
export function createLiveMorningDeps(store: MorningRepository): MorningDeps {
  return {
    now: () => Date.now(),
    readState: entityId => getState(entityId),
    store,
    runScript: entityId => callService("script", "turn_on", { entity_id: entityId }),
    switchOn: entityId => callService("switch", "turn_on", { entity_id: entityId }),

    // Throwaway conversation, and a profile without tools: writing a greeting must never act.
    writeGreeting: async request => {
      const { content } = await runAgent(request, `morning-${Date.now()}`, moduleLog(), { profile: "morning_greeting" });
      return content;
    },

    speakOnPhone: async text => {
      const service = config.morning.phoneNotifyService;
      if (service !== undefined) await speakOnPhone(service, text);
    },
  };
}
