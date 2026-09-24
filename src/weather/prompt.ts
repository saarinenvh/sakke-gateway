// Each feature owns the prompt rules for its own tools, so a rule and the tool
// it governs move together. They used to live in one 92-line template literal
// in systemPrompt.ts, which is how the run_routine rules and the routine tool
// drifted apart (see CODE_REVIEW.md #12).
export function weatherPrompt(): string {
  return `Weather: use get_weather. Your training data has no idea what it is doing outside right now.`;
}
