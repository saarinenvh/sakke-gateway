import type { ToneLevel } from "./policy.js";

// What the model is told when it writes a nag, and what it is told when the
// owner's answer comes back. The words themselves are always the model's -
// these only set the facts and how sharp to be.

// Escalation is the owner's explicit opt-in. It stays aimed at the floor and
// the procrastination, never at the owner as a person, and never invents facts.
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
}

export function buildNagRequest(facts: NagFacts): string {
  return [
    "You are about to ask the owner, out loud and unprompted, whether you should run the robot vacuum now.",
    `Facts: the house was last cleaned ${describeDays(facts.daysSinceClean)}.`,
    `They have said no ${describeDeclines(facts.declines)} since then.`,
    `Tone: ${TONE_DESCRIPTIONS[facts.tone]}`,
    "Write only the one short spoken question, ending in a question mark. Do not call any tools and do not start the vacuum.",
  ].join(" ");
}

// Sent with start_conversation as extra_system_prompt: the owner's reply
// arrives as a brand-new conversation, and this is all it knows about why.
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
