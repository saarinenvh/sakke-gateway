export function searchPrompt(): string {
  // Interpolated, not hardcoded. This line used to say "Current year is 2026"
  // in a prompt whose entire point is telling the model not to trust its own
  // stale knowledge.
  const year = new Date().getFullYear();
  return `Web search: use web_search for anything current — news, prices, standings, recent events. It is ${year}; your training data is older than that and you cannot tell when it is wrong.`;
}
