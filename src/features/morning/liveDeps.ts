import { runAgent } from "../../agent/agent.js";
import { config } from "../../config.js";
import { callService, getState } from "../../integrations/homeAssistant/client.js";
import { speakOnPhone } from "../../integrations/homeAssistant/phone.js";
import { moduleLog } from "../../logger.js";
import { speakOnSatellite } from "../announcements/announcer.js";
import { getPcInput } from "../gpu/gpuStatus.js";
import type { BriefDeps } from "./brief.js";
import type { MorningDeps } from "./wakeUp.js";
import type { MorningRepository } from "./morningRepository.js";

// Separate from wakeUp.ts and brief.ts so they don't import the agent and every tool.
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

// What the brief reports on. Injected by index.ts: they live under tools/, and
// a feature doesn't import tools.
export type DayReaders = Pick<BriefDeps, "readCalendar" | "readTasks" | "readWeather">;

export function createLiveBriefDeps(store: MorningRepository, readers: DayReaders): BriefDeps {
  return {
    now: () => Date.now(),
    readState: entityId => getState(entityId),
    store,
    readPcInput: getPcInput,
    ...readers,

    // Throwaway conversation, and a profile without tools: writing a brief must never act.
    writeBrief: async request => {
      const { content } = await runAgent(request, `morning-brief-${Date.now()}`, moduleLog(), { profile: "morning_brief" });
      return content;
    },
    speak: text => speakOnSatellite(text),
  };
}
