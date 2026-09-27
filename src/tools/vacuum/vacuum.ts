import { config } from "../../config.js";
import { callService, getState } from "../../integrations/homeAssistant/client.js";
import type { VacuumEntity } from "../../integrations/homeAssistant/registry.js";
import { findAnswerableNag, localDaysBetween } from "../../features/tidiness/policy.js";
import { getTidinessState, recordClean, snoozeUntil, updateNag } from "../../features/tidiness/store.js";
import { findVacuum } from "../../features/tidiness/vacuum.js";

export const VACUUM_ACTIONS = ["start", "stop", "dock", "status", "last_cleaned", "mark_cleaned", "decline", "snooze"] as const;
export type VacuumAction = (typeof VACUUM_ACTIONS)[number];

// Pure reads; every other action moves the vacuum or changes reminder state.
export const READ_ONLY_VACUUM_ACTIONS: ReadonlySet<string> = new Set<VacuumAction>(["status", "last_cleaned"]);

// HA services behind the three movement actions.
const MOVEMENT_SERVICES = {
  start: "start",
  stop: "stop",
  dock: "return_to_base",
} as const satisfies Partial<Record<VacuumAction, string>>;

const MOVEMENT_REPLIES = {
  start: "The vacuum has started cleaning.",
  stop: "The vacuum has stopped.",
  dock: "The vacuum is heading back to its dock.",
} as const satisfies Record<keyof typeof MOVEMENT_SERVICES, string>;

export async function runVacuumAction(action: VacuumAction, now: number): Promise<string> {
  switch (action) {
    case "start":
    case "stop":
    case "dock":
      return moveVacuum(action, now);
    case "status":
      return describeVacuum(now);
    case "last_cleaned":
      return describeLastCleaned(now);
    case "mark_cleaned":
      return markCleaned(now);
    case "decline":
      return declineCleaning(now);
    case "snooze":
      return snoozeReminders(now);
  }
}

// --- Movement ---------------------------------------------------------------

async function moveVacuum(action: keyof typeof MOVEMENT_SERVICES, now: number): Promise<string> {
  const lookup = findVacuum();
  if (lookup.kind === "none") return "There is no robot vacuum in Home Assistant.";
  if (lookup.kind === "ambiguous") {
    return `There are several vacuums (${lookup.names.join(", ")}) and none is configured as the one to use.`;
  }

  await callService("vacuum", MOVEMENT_SERVICES[action], { entity_id: lookup.vacuum.entity_id });

  // Starting in reply to a cleaning reminder answers it.
  if (action === "start") await answerPendingNag("yes", now);
  return MOVEMENT_REPLIES[action];
}

// --- Status -----------------------------------------------------------------

async function describeVacuum(now: number): Promise<string> {
  const lookup = findVacuum();
  const lastCleaned = describeLastCleaned(now);
  if (lookup.kind !== "found") return `No single vacuum to report on. ${lastCleaned}`;

  const vacuumState = await getState(lookup.vacuum.entity_id);
  const battery = await readBatteryPct(lookup.vacuum, vacuumState.attributes.battery_level);
  const batteryText = battery === undefined ? "" : `, battery ${battery}%`;
  return `The vacuum is ${vacuumState.state}${batteryText}. ${lastCleaned}`;
}

// A vacuum attribute on older integrations, a separate sensor on newer ones.
async function readBatteryPct(vacuum: VacuumEntity, attribute: unknown): Promise<number | undefined> {
  if (typeof attribute === "number") return attribute;
  if (vacuum.batterySensorId === undefined) return undefined;
  try {
    const sensor = await getState(vacuum.batterySensorId);
    const pct = Number(sensor.state);
    return Number.isFinite(pct) ? pct : undefined;
  } catch {
    return undefined; // Battery is a nice-to-have; the rest of the status stands.
  }
}

export function describeLastCleaned(now: number): string {
  const { lastCleanedAt, lastCleanedBy } = getTidinessState();
  if (lastCleanedAt === undefined) {
    return "When the house was last cleaned is not known yet - only runs from now on are noticed.";
  }

  const when = describeDaysAgo(lastCleanedAt, now);
  const how = lastCleanedBy === "manual" ? "by hand, as reported" : "by the vacuum";
  return `The house was last cleaned ${when}, ${how}.`;
}

function describeDaysAgo(cleanedAt: number, now: number): string {
  const days = localDaysBetween(cleanedAt, now, config.timezone);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";

  const date = new Date(cleanedAt).toLocaleDateString("en-GB", {
    timeZone: config.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return `${days} days ago, on ${date}`;
}

// --- Answers to a cleaning reminder -------------------------------------------

async function markCleaned(now: number): Promise<string> {
  await recordClean(now, "manual");
  await answerPendingNag("yes", now);
  return "Recorded: the house has been cleaned today.";
}

async function declineCleaning(now: number): Promise<string> {
  const answered = await answerPendingNag("no", now);
  return answered ? "Recorded that they declined. The reminders continue on schedule." : "There was no recent cleaning reminder to decline.";
}

async function snoozeReminders(now: number): Promise<string> {
  const hours = config.tidiness.snoozeHours;
  await snoozeUntil(now + hours * 3_600_000);
  await answerPendingNag("no", now);
  return `Cleaning reminders are snoozed for ${hours} hours.`;
}

async function answerPendingNag(answer: "yes" | "no", now: number): Promise<boolean> {
  const nag = findAnswerableNag(getTidinessState().nags, now);
  if (!nag) return false;
  await updateNag(nag.slot, { answer });
  return true;
}
