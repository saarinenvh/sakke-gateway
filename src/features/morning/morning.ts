import { config } from "../../config.js";
import { callService, getState } from "../../integrations/homeAssistant/client.js";
import { speakOnPhone } from "../../integrations/homeAssistant/phone.js";
import { moduleLog } from "../../logger.js";
import { speakOnSatellite } from "../announcements/announcements.js";
import { getPcInput } from "../gpu/gpu.js";
import { writeText } from "../../inference/writeText.js";
import { getWeather } from "../../integrations/openMeteo/weather.js";
import { getCalendarText, getTasksText } from "../reminders/reminders.js";
import { startMorningBrief, type BriefDeps } from "./brief.js";
import { setCoffeeAnswerStore } from "./coffee.js";
import { startMorningWakeUp, type MorningDeps } from "./wakeUp.js";
import type { MorningRepository } from "./db/morningRepository.js";

// The morning wake-up and the day summary, with their real dependencies. Both
// keep their state in the database, so index.ts starts them once it's connected.
export function startMorning(store: MorningRepository): void {
  setCoffeeAnswerStore(store);
  startMorningWakeUp(createMorningDeps(store));
  startMorningBrief(createBriefDeps(store));
}

function createMorningDeps(store: MorningRepository): MorningDeps {
  return {
    now: () => Date.now(),
    readState: entityId => getState(entityId),
    store,
    runScript: entityId => callService("script", "turn_on", { entity_id: entityId }),
    switchOn: entityId => callService("switch", "turn_on", { entity_id: entityId }),

    // A profile without tools: writing a greeting must never act.
    writeGreeting: request => writeText("morning_greeting", request, moduleLog()),

    speakOnPhone: async text => {
      const service = config.morning.phoneNotifyService;
      if (service !== undefined) await speakOnPhone(service, text);
    },
  };
}

function createBriefDeps(store: MorningRepository): BriefDeps {
  return {
    now: () => Date.now(),
    readState: entityId => getState(entityId),
    store,
    readPcInput: getPcInput,
    readCalendar: () => getCalendarText("today"),
    readTasks: () => getTasksText("today"),
    readWeather: () => getWeather(),

    // A profile without tools: writing a brief must never act.
    writeBrief: request => writeText("morning_brief", request, moduleLog()),
    speak: text => speakOnSatellite(text),
  };
}
