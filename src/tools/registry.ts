import type { FastifyBaseLogger } from "fastify";
import type { Tool, ToolDefinition } from "./types.js";
import { INFERENCE_PROFILES, type InferenceProfile, type InferenceProfileName } from "../inference/profiles.js";
import type { ScheduledJob } from "../features/scheduling/db/ScheduledJob.entity.js";
import type { JobOutcome } from "../features/scheduling/scheduling.js";

import { controlHomeAssistantTool, getDeviceStateTool, runRoutineTool, refreshHomeDataTool } from "./homeControl/tool.js";
import { webSearchTool } from "./search/tool.js";
import { weatherTool } from "./weather/tool.js";
import { spotifyTool } from "./spotify/tool.js";
import { manageListTool } from "./lists/tool.js";
import { openTvAppTool, tvRemoteCommandTool, tvSendTextTool } from "./tv/tool.js";
import { createKnowledgeTool, getContextTool } from "./wiki/tool.js";
import { getTasksTool, getCalendarTool } from "./reminders/tool.js";
import { scheduleTool } from "./schedule/tool.js";
import { setGamingModeTool } from "./gpu/tool.js";
import { vacuumTool } from "./vacuum/tool.js";
import { announceTool } from "./announce/tool.js";
import { coffeeTool } from "./coffee/tool.js";

// Every tool, in the order the model is shown them. Which ones a request may
// use is its profile's choice (inference/profiles.ts). The order is what the
// model has been living with; reordering a tool list is not a free change.
const ALL: Tool[] = [
  controlHomeAssistantTool,
  webSearchTool,
  weatherTool,
  spotifyTool,
  manageListTool,
  openTvAppTool,
  tvRemoteCommandTool,
  tvSendTextTool,
  getDeviceStateTool,
  runRoutineTool,
  createKnowledgeTool,
  getContextTool,
  getTasksTool,
  scheduleTool,
  refreshHomeDataTool,
  setGamingModeTool,
  getCalendarTool,
  vacuumTool,
  announceTool,
  coffeeTool,
];

const byName = new Map<string, Tool>();
for (const tool of ALL) {
  const { name } = tool.definition.function;
  // A duplicated name would otherwise shadow silently: the model would still
  // be offered both schemas, but only one would ever run.
  if (byName.has(name)) throw new Error(`Duplicate tool name in registry: ${name}`);
  byName.set(name, tool);
}

// A profile naming a tool that doesn't exist would silently take that tool
// away from every request using it.
const unknownProfileTools = findUnknownProfileTools(INFERENCE_PROFILES, new Set(byName.keys()));
if (unknownProfileTools.length > 0) {
  throw new Error(`Inference profiles name unknown tools: ${unknownProfileTools.join(", ")}`);
}

/** Every registered tool's schema. */
export const tools: ToolDefinition[] = ALL.map(t => t.definition);

/** The schemas offered to the model under this profile, in registry order. */
export function toolsForProfile(profile: InferenceProfileName): ToolDefinition[] {
  return ALL.filter(t => isToolInProfile(profile, t.definition.function.name)).map(t => t.definition);
}

export function isToolInProfile(profile: InferenceProfileName, name: string): boolean {
  const allowed: readonly string[] = INFERENCE_PROFILES[profile].tools;
  return allowed.includes(name);
}

export function findUnknownProfileTools(
  profiles: Record<string, InferenceProfile>,
  knownToolNames: ReadonlySet<string>,
): string[] {
  const unknown: string[] = [];
  for (const [profileName, profile] of Object.entries(profiles)) {
    for (const toolName of profile.tools) {
      if (!knownToolNames.has(toolName)) unknown.push(`${profileName}.${toolName}`);
    }
  }
  return unknown;
}

export function toolNames(): string[] {
  return [...byName.keys()];
}

// Unknown names shouldn't reach here (executeTool already handles that case),
// but default to false regardless - re-executing something unrecognized is
// never the safe assumption.
export function isRepeatable(name: string, args: Record<string, unknown>): boolean {
  return byName.get(name)?.repeatable(args) ?? false;
}

// Unknown names are never schedulable.
export function isSchedulable(name: string, args: Record<string, unknown>): boolean {
  return byName.get(name)?.schedulable?.(args) ?? false;
}

// Runs a scheduled job's stored call. Checked again here, not only when the job
// was scheduled: a tool can stop being schedulable between the two.
export async function runScheduledCall(job: ScheduledJob, log: FastifyBaseLogger): Promise<JobOutcome> {
  if (!isSchedulable(job.tool, job.args)) {
    return { status: "failed", result: `${job.tool} can't be run by the scheduler` };
  }
  const run = await runTool(job.tool, job.args, log, `schedule-${job.id}`);
  switch (run.kind) {
    case "ok":
      return { status: "done", result: run.result };
    case "failed":
      return { status: "failed", result: run.error };
    case "unknown":
      return { status: "failed", result: `unknown tool: ${job.tool}` };
  }
}

// Results go into the conversation, so they're logged in full only up to a
// point - get_context returns whole wiki pages and web_search returns a page
// of extracts.
function preview(result: string): string {
  return result.length > 300 ? `${result.slice(0, 300)}…` : result;
}

export type ToolRun =
  | { kind: "ok"; result: string }
  | { kind: "failed"; error: string }
  | { kind: "unknown" };

// Runs a tool and reports how it went. Never throws: a tool that throws past
// here would take down whatever called it - a conversation turn, or a
// scheduled job.
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  log: FastifyBaseLogger,
  conversationId: string,
): Promise<ToolRun> {
  const tool = byName.get(name);
  if (!tool) {
    log.warn({ conversationId, tool: name }, "Unknown tool requested");
    return { kind: "unknown" };
  }

  log.info({ conversationId, tool: name, args }, "Tool call");
  try {
    const result = await tool.execute(args, { log, conversationId });
    log.info({ conversationId, tool: name, result: preview(result) }, "Tool result");
    return { kind: "ok", result };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error({ conversationId, tool: name, err: error }, "Tool failed");
    return { kind: "failed", error };
  }
}

// The same, as the text the model sees: a failure is something it can tell
// the owner about or work around.
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  log: FastifyBaseLogger,
  conversationId: string,
): Promise<string> {
  const run = await runTool(name, args, log, conversationId);
  switch (run.kind) {
    case "ok":
      return run.result;
    case "failed":
      return `${name} failed: ${run.error}`;
    case "unknown":
      return `Unknown tool: ${name}`;
  }
}
