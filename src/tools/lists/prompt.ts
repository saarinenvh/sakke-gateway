import { storeSections } from "../../features/shoppingList/shoppingList.js";
import { getTodoLists } from "./lists.js";

export async function listsPrompt(): Promise<string> {
  // getTodoLists makes a live HA call on every turn. A momentary outage used to
  // throw here and break the whole conversation, not just list-related requests.
  let lists = "  (unable to load lists right now)";
  try {
    lists = (await getTodoLists()).map(l => `  - ${l.name} (${l.entity_id})`).join("\n");
  } catch { /* HA unreachable - degrade rather than fail the turn */ }

  // Read from the wiki on every turn too; with no wiki page and no bundled copy
  // (a broken build) it throws.
  let sections = "  (store layout unavailable right now)";
  try {
    sections = storeSections().map((section, i) => `  ${i + 1}. ${section}`).join("\n");
  } catch { /* layout unreadable - degrade rather than fail the turn */ }

  return `Lists: use manage_list for every shopping and todo list action — add, remove, read, complete. The list only changes if you call the tool.

Available lists:
${lists}

Shopping list store layout (items are auto-sorted in this order when added):
${sections}`;
}
