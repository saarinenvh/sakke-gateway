import { config } from "../../config.js";

// With the morning wake-up on, the coffee maker only starts if it was reported loaded.
function goodNightSendOff(): string {
  if (!config.morning.enabled) return "Respond with a short dry send-off, 1-2 sentences";
  return "Respond with a short dry send-off, and ask whether they loaded the coffee maker for the morning. When they answer, call coffee with set_loaded";
}

export function remindersPrompt(): string {
  return `Tasks and calendar are different things: get_tasks is for chores and to-dos, get_calendar is for events and appointments at a time. Do not confuse them. Personal tasks live in ${config.ha.tasksTodo} — use that entity when completing or adding tasks.

Good night routine — ONLY when the user explicitly says "good night", "hyvää yötä" or "goodnight":
1. Call run_routine with script_id good_night (lights off, TV off, bedroom TV on)
2. ${goodNightSendOff()}`;
}
