import { promises as fs } from "fs";
import { join } from "path";
import { config } from "../config.js";
import { homeControlPrompt } from "../homeControl/prompt.js";
import { listsPrompt } from "../lists/prompt.js";
import { remindersPrompt } from "../reminders/prompt.js";
import { spotifyPrompt } from "../spotify/prompt.js";
import { weatherPrompt } from "../weather/prompt.js";
import { searchPrompt } from "../search/prompt.js";
import { wikiPrompt } from "../wiki/prompt.js";

// Composes the system prompt from per-feature fragments. Each feature owns the
// rules for its own tools, so the two move together instead of drifting apart
// in a single 92-line template literal three directories away.
//
// The order is explicit and load-bearing, not incidental: who Sakke is, then
// the one rule that matters most, then capabilities, then the live inventory of
// the house. Appending a section in the wrong place is a real behaviour change.
type PromptSection = () => string | Promise<string>;

const SECTIONS: PromptSection[] = [
  () => readMarkdown("persona.md"),
  () => readMarkdown("toolDiscipline.md"),
  homeControlPrompt,
  listsPrompt,
  remindersPrompt,
  spotifyPrompt,
  weatherPrompt,
  searchPrompt,
  wikiPrompt,
  () => clockLine(),
];

async function readMarkdown(name: string): Promise<string> {
  return (await fs.readFile(join(__dirname, "prompts", name), "utf-8")).trim();
}

// The model has no clock of its own, and nothing else in the prompt or the
// tools told it the time - asked "what time is it" it could only say it had no
// access to real-time information, and "tomorrow" meant nothing to it either.
const CLOCK_PREFIX = "Current date and time:";

function clockLine(now = new Date()): string {
  const formatted = now.toLocaleString("en-GB", {
    timeZone: config.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${CLOCK_PREFIX} ${formatted} (${config.timezone}).`;
}

// The system prompt is built once per conversation and then stored with its
// history, so without this the clock would stay frozen at the conversation's
// first turn for as long as follow-ups keep it alive.
export function refreshClock(systemPrompt: string): string {
  return systemPrompt.replace(new RegExp(`^${CLOCK_PREFIX}.*$`, "m"), clockLine());
}

export async function buildSystemPrompt(): Promise<string> {
  const sections = await Promise.all(SECTIONS.map(section => section()));
  return sections.map(s => s.trim()).filter(Boolean).join("\n\n");
}
