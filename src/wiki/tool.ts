import type { Tool } from "../tools/types.js";
import { readPage, saveNote } from "./wiki.js";

export const getContextTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "get_context",
      description: "Load a knowledge base page for detailed context about the user or a topic. Only call when the query is clearly about something in the knowledge base. Check available pages in the system prompt.",
      parameters: {
        type: "object",
        properties: {
          page: { type: "string", description: "Page path from the knowledge base index, e.g. user/user_profile or discgolf/context. Strip [[ and ]] from wikilinks." },
        },
        required: ["page"],
      },
    },
  },
  // Catches for itself: a missing page is a normal answer the model should act
  // on, not a failure, and the two ways of missing are worth telling apart in
  // the log even though the model is told the same thing either way.
  execute: async (args, { log }) => {
    const page = args.page as string;
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
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Short descriptive filename without extension, e.g. espoo_disc_golf_courses or prefers_dark_roast_coffee" },
          content: { type: "string", description: "Markdown content for the note. Include a # title, the fact, and any relevant context." },
        },
        required: ["filename", "content"],
      },
    },
  },
  execute: async (args, { log }) => {
    const { filename, isNew } = await saveNote(args.filename as string, args.content as string);
    log.info({ filename, isNew }, "Knowledge note saved");
    return `Saved note "${filename}".`;
  },
};
