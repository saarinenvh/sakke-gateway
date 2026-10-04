import type { Tool } from "../types.js";
import { toolParameters, parseToolArgs } from "../parameters.js";
import { createKnowledgeArgsSchema, getContextArgsSchema } from "./schema.js";
import { readPage, saveNote } from "../../features/wiki/wiki.js";

export const getContextTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "get_context",
      description: "Load a knowledge base page for detailed context about the user or a topic. Only call when the query is clearly about something in the knowledge base. Check available pages in the system prompt.",
      parameters: toolParameters(getContextArgsSchema),
    },
  },
  repeatable: () => true,
  // Catches for itself: a missing page is a normal answer the model should act
  // on, not a failure, and the two ways of missing are worth telling apart in
  // the log even though the model is told the same thing either way.
  execute: async (args, { log }) => {
    const { page } = parseToolArgs(getContextArgsSchema, args, "get_context");
    const result = await readPage(page);
    if (result.ok) return result.content;
    if (result.reason === "escapes-root") {
      log.warn({ page, path: result.path }, "get_context path escapes the wiki root");
    } else {
      log.warn({ page, path: result.path }, "get_context page not found");
    }
    return `No knowledge base page found for "${page}". Available pages are listed in the system prompt.`;
  },
};

export const createKnowledgeTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "create_knowledge",
      description: "Save a new knowledge note. Use when the user shares something worth remembering — a fact, preference, experience, or piece of info. Pick a short descriptive filename. The note is saved to sakke-knowledge/ and added to sakke-index automatically. Always format content as: '## Title\\n\\nShort description of the fact or preference.'",
      parameters: toolParameters(createKnowledgeArgsSchema),
    },
  },
  repeatable: () => false,
  execute: async (args, { log }) => {
    const note = parseToolArgs(createKnowledgeArgsSchema, args, "create_knowledge");
    const { filename, isNew } = await saveNote(note.filename, note.content);
    log.info({ filename, isNew }, "Knowledge note saved");
    return `Saved note "${filename}".`;
  },
};
