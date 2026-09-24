import { promises as fs } from "fs";
import { join } from "path";
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
];

async function readMarkdown(name: string): Promise<string> {
  return (await fs.readFile(join(__dirname, "prompts", name), "utf-8")).trim();
}

export async function buildSystemPrompt(): Promise<string> {
  const sections = await Promise.all(SECTIONS.map(section => section()));
  return sections.map(s => s.trim()).filter(Boolean).join("\n\n");
}
