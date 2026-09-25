import type { Tool } from "../tools/types.js";
import { readList, addToList, completeInList, removeFromList, sortList } from "./lists.js";

export const manageListTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "manage_list",
      description: "Read, add, complete, or remove items from todo and shopping lists",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list_read", "list_add", "list_complete", "list_remove", "list_sort"],
          },
          list: { type: "string", description: "Entity ID of the list, e.g. todo.groceries" },
          items: { type: "array", items: { type: "string" }, description: "Items to add (for list_add)" },
          item: { type: "string", description: "Item name to complete or remove" },
        },
        required: ["action", "list"],
      },
    },
  },
  execute: async args => {
    const { action, list, items, item } = args as { action: string; list: string; items?: string[]; item?: string };

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
