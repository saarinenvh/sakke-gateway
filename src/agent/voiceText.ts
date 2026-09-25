// Everything Piper must never read out loud.
//
// Deliberately deterministic rather than trusting the system prompt's "no
// markdown" rule, which the model does not reliably follow even after that rule
// was reinforced twice. Its own module because it is pure, it has accumulated
// four separate live bugs, and a sanitiser's real risk is over-stripping - none
// of which is visible while it sits inline in the agent loop.

export function cleanForSpeech(raw: string | undefined, toolsWereWithheld: boolean): string {
  const cleaned = (raw ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<channel\|>[\s\S]*/gi, "")
    // Withholding the tool schema stops the runtime PARSING a tool call, not
    // the model emitting one - so it arrives as ordinary content instead.
    // Seen live: a withheld-tools pass answered with
    // `<tool_call>{"name": "get_weather", "arguments": {}}</tool_call>`, which
    // the rest of this chain happily turned into a sentence for Piper to read
    // out loud. Paired form first, then any unterminated remainder.
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<\/?tool_call>[\s\S]*/gi, "")
    // The model doesn't reliably follow the "no markdown" voice rule on its
    // own (confirmed even after reinforcing it) - strip it deterministically
    // instead of continuing to depend on prompt compliance for something a
    // TTS voice would otherwise read literally (asterisks, list numbers, etc).
    // Links keep their text and lose the URL - seen live as
    // "[time.gov](https://www.time.gov/)", which Piper read out in full.
    .replace(/\[([^\]]+)\]\([^)\s]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    // Turn line breaks into sentence breaks (not spaces) so former list items
    // get spoken with natural pauses instead of running together.
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/[:.]\s*\./g, m => m.trimEnd().slice(0, 1))
    .replace(/ {2,}/g, " ")
    .trim();

  if (cleaned) return cleaned;

  // Nothing left once the scaffolding is gone. On the forced pass that means
  // the model had nothing to say but another tool call, which is worth
  // admitting rather than papering over.
  return toolsWereWithheld
    ? "That didn't work. Ask me again."
    : "I got nothing.";
}
