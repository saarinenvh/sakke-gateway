import type { CoffeeNews, MorningStart } from "./policy.js";

const COFFEE_FACTS: Record<CoffeeNews, string> = {
  brewing: "The coffee maker was loaded last night and is brewing now.",
  failed_to_start: "The coffee maker was loaded last night, but starting it just failed.",
  not_loaded: "The owner said last night the coffee maker wasn't loaded, so there is no coffee.",
  unknown: "Nobody said last night whether the coffee maker was loaded, so it was left off.",
};

// Spoken when the model can't write the greeting.
const FALLBACK_GREETINGS: Record<CoffeeNews, string> = {
  brewing: "Good morning. The coffee is brewing.",
  failed_to_start: "Good morning. I couldn't start the coffee maker.",
  not_loaded: "Good morning. No coffee today, the maker wasn't loaded.",
  unknown: "Good morning. I didn't hear about the coffee last night, so it's off.",
};

export function buildGreetingRequest(coffee: CoffeeNews): string {
  return [
    "The owner's alarm just rang and they are still in bed. You have turned on the bedroom lights.",
    "Say good morning, out loud, in one or two short sentences, and mention the coffee.",
    `Facts: ${COFFEE_FACTS[coffee]}`,
    "Ask no questions: the owner can't answer. Write only what you'll say. Do not call any tools.",
  ].join(" ");
}

export function fallbackGreeting(coffee: CoffeeNews): string {
  return FALLBACK_GREETINGS[coffee];
}

// --- The day summary ------------------------------------------------------------

export interface DayFacts {
  calendar: string;
  tasks: string;
  weather: string;
}

export interface BriefFacts {
  day: DayFacts;
  start: MorningStart;
  timezone: string;
  structureHint: string;
  yesterdayBrief: string | null;
}

// One is picked per day in code: left alone, a small model repeats one shape.
export const STRUCTURE_HINTS = [
  "Lead with the weather, then what's on the calendar, then the tasks.",
  "Lead with the earliest or biggest thing on the calendar, then fill in the rest.",
  "Open with a one-line verdict on the day ahead, then the details.",
  "Lead with the tasks, as if they've been waiting for the owner, then the calendar and the weather.",
  "Tie the weather to what the day's plans mean, and end on the tasks.",
] as const;

export function buildBriefRequest(facts: BriefFacts): string {
  return [
    `${describeStart(facts.start, facts.timezone)} They have just sat down at the PC, with coffee.`,
    "You already said good morning on their phone. Now, out loud on the speaker, open by noting they actually got up, then brief them on the day.",
    `Facts. ${facts.day.calendar} ${facts.day.tasks} Weather: ${facts.day.weather.replace(/\n/g, "; ")}.`,
    `Structure: ${facts.structureHint}`,
    facts.yesterdayBrief ? `Yesterday you said: "${facts.yesterdayBrief}" Don't open the same way.` : "",
    "Keep it to a few spoken sentences, mention only these facts, and ask nothing. Write only what you'll say. Do not call any tools.",
  ].filter(Boolean).join(" ");
}

// Spoken when the model can't write the brief.
export function fallbackBrief(day: DayFacts): string {
  const conditions = day.weather.split("\n").slice(0, 2).join(", ");
  return `Good, you're up. ${day.calendar} ${day.tasks} ${conditions}.`;
}

function describeStart(start: MorningStart, timezone: string): string {
  const time = new Date(start.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timezone });
  return start.source === "alarm"
    ? `The owner's alarm rang at ${time}.`
    : `The owner's watch says they woke at ${time}.`;
}
