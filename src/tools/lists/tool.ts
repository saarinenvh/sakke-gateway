import type { Tool } from "../types.js";
import { toolParameters, parseToolArgs } from "../parameters.js";
import { manageListArgsSchema } from "./schema.js";
import { readList, addToList, completeInList, removeFromList, sortList } from "./lists.js";

export const manageListTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "manage_list",
      description: "Read, add, complete, or remove items from todo and shopping lists",
      parameters: toolParameters(manageListArgsSchema),
    },
  },
  // Reading a list back is harmless to repeat; every mutating action isn't.
  repeatable: args => args.action === "list_read",
  execute: async args => {
    const { action, list, items, item } = parseToolArgs(manageListArgsSchema, args, "manage_list");

    if (action === "list_read") return readList(list);
    if (action === "list_add") {
      // The model puts a whole spoken phrase in one string often enough that
      // splitting here is cheaper than fighting it in the prompt.
      const raw = items?.length ? items : item ? [item] : [];
      return addToList(list, raw.flatMap(s => s.split(/,\s*|\s+and\s+/i).map(t => t.trim()).filter(Boolean)));
    }
    if (action === "list_complete") return completeInList(list, item ?? "");
    if (action === "list_remove") return removeFromList(list, item ?? "");
    if (action === "list_sort") return sortList(list);
    return `Unknown list action: ${action}`;
  },
};
