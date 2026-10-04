import { z } from "zod";

// Model → gateway: the arguments of a get_context tool call.

export const getContextArgsExample = { page: "discgolf/context" };

export const getContextArgsSchema = z.object({
  page: z.string().describe("Page path from the knowledge base index, e.g. user/user_profile or discgolf/context. Strip [[ and ]] from wikilinks."),
});

// Model → gateway: the arguments of a create_knowledge tool call.

export const createKnowledgeArgsExample = {
  filename: "prefers_dark_roast_coffee",
  content: "## Prefers dark roast coffee\n\nLikes a dark roast, brewed strong, no milk.",
};

export const createKnowledgeArgsSchema = z.object({
  filename: z.string().describe("Short descriptive filename without extension, e.g. espoo_disc_golf_courses or prefers_dark_roast_coffee"),
  content: z.string().describe("Markdown content for the note. Include a # title, the fact, and any relevant context."),
});
