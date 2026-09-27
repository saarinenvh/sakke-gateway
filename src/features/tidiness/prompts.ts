import type { ToneLevel } from "./policy.js";

// Escalation is opted into by the owner: aimed at the floor, never the person.
const TONE_DESCRIPTIONS: Record<ToneLevel, string> = {
  1: "Light and polite: a gentle, witty nudge.",
  2: "Pointed: a dry remark that the dust has started to notice.",
  3: "Sarcastic: make it clear this is turning into a pattern.",
  4: "Openly exasperated: theatrical butler disappointment.",
  5: "Maximum disdain, still funny: treat the state of the floor as a personal affront.",
};

export interface NagFacts {
  daysSinceClean: number;
  declines: number;
  tone: ToneLevel;
  vacuumName: string | undefined;
}

export function buildNagRequest(facts: NagFacts): string {
  return [
    "You are about to ask the owner, out loud and unprompted, whether you should run the robot vacuum now.",
    facts.vacuumName ? `The owner calls the vacuum ${facts.vacuumName}.` : "",
    `Facts: the house was last cleaned ${describeDays(facts.daysSinceClean)}.`,
    `They have said no ${describeDeclines(facts.declines)} since then.`,
    `Tone: ${TONE_DESCRIPTIONS[facts.tone]}`,
    "Write only the one short spoken question, ending in a question mark. Do not call any tools and do not start the vacuum.",
  ].filter(Boolean).join(" ");
}

// Sent as extra_system_prompt: the reply arrives as a new conversation.
export function buildAnswerContext(question: string, facts: NagFacts): string {
  return [
    `You just asked the owner, unprompted: "${question}"`,
    `The house was last cleaned ${describeDays(facts.daysSinceClean)}.`,
    "Their next words are their answer. If they agree, call vacuum with action start.",
    "If they decline or say not now, call vacuum with action decline.",
    "If they want you to stop reminding them, call vacuum with action snooze.",
    "If they say they already cleaned, call vacuum with action mark_cleaned.",
  ].join(" ");
}

function describeDays(days: number): string {
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function describeDeclines(declines: number): string {
  if (declines === 0) return "zero times";
  return declines === 1 ? "once" : `${declines} times`;
}
