import type { FastifyBaseLogger } from "fastify";
import type { Tool, ToolDefinition } from "./types.js";

import { controlHomeAssistantTool, getDeviceStateTool, runRoutineTool, refreshHomeDataTool } from "../homeControl/tool.js";
import { webSearchTool } from "../search/tool.js";
import { weatherTool } from "../weather/tool.js";
import { spotifyTool } from "../spotify/tool.js";
import { manageListTool } from "../lists/tool.js";
import { openTvAppTool, tvRemoteCommandTool, tvSendTextTool } from "../tv/tool.js";
import { createKnowledgeTool, getContextTool } from "../wiki/tool.js";
import { getTasksTool, getCalendarTool } from "../reminders/tool.js";
import { timerTool } from "../timers/tool.js";
import { setGamingModeTool } from "../gpu/tool.js";

// The whole tool surface, in the order the model is shown it. There used to be
// two lists to keep in step - a 300-line array of schemas and a 400-line chain
// of `if (name === ...)` branches in a separate file - and adding a tool meant
// editing both, in the right place, without forgetting the logging or the
// try/catch. Now each feature owns its own tools and this is the only list.
//
// Order is preserved from that original array: it's what the model has been
// living with, and reordering a tool list is not a free change.
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
  timerTool,
  refreshHomeDataTool,
  setGamingModeTool,
  getCalendarTool,
];

const byName = new Map<string, Tool>();
for (const tool of ALL) {
  const { name } = tool.definition.function;
  // A duplicated name would otherwise shadow silently: the model would still
  // be offered both schemas, but only one would ever run.
  if (byName.has(name)) throw new Error(`Duplicate tool name in registry: ${name}`);
  byName.set(name, tool);
}

/** The schemas sent to Ollama. */
export const tools: ToolDefinition[] = ALL.map(t => t.definition);

export function toolNames(): string[] {
  return [...byName.keys()];
}

// Results go into the conversation, so they're logged in full only up to a
// point - get_context returns whole wiki pages and web_search returns a page
// of extracts.
function preview(result: string): string {
  return result.length > 300 ? `${result.slice(0, 300)}…` : result;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  log: FastifyBaseLogger,
  conversationId: string,
): Promise<string> {
  const tool = byName.get(name);
  if (!tool) {
    log.warn({ conversationId, tool: name }, "Unknown tool requested");
    return `Unknown tool: ${name}`;
  }

  log.info({ conversationId, tool: name, args }, "Tool call");
  try {
    const result = await tool.execute(args, { log, conversationId });
    log.info({ conversationId, tool: name, result: preview(result) }, "Tool result");
    return result;
  } catch (err: any) {
    // Never rethrow. A tool result is a message in the conversation; a thrown
    // error here takes down the whole turn instead of giving the model
    // something it can tell the user about or work around.
    log.error({ conversationId, tool: name, err: err.message }, "Tool failed");
    return `${name} failed: ${err.message}`;
  }
}
