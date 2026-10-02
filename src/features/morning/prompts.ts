import type { CoffeeNews } from "./policy.js";

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
