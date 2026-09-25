// LLMs often wrap structured output (JSON, YAML, ...) in a markdown code
// fence even when asked for the raw content directly. Strips a leading
// ```<lang> and trailing ``` if present; content without a fence is returned
// unchanged.
export function stripCodeFence(content: string): string {
  return content
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}
