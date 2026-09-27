import { getTodoLists, STORE_LAYOUT_SECTIONS } from "./lists.js";

export async function listsPrompt(): Promise<string> {
  // getTodoLists makes a live HA call on every turn. A momentary outage used to
  // throw here and break the whole conversation, not just list-related requests.
  let lists = "  (unable to load lists right now)";
  try {
    lists = (await getTodoLists()).map(l => `  - ${l.name} (${l.entity_id})`).join("\n");
  } catch { /* HA unreachable - degrade rather than fail the turn */ }

  return `Lists: use manage_list for every shopping and todo list action — add, remove, read, complete. The list only changes if you call the tool.

Available lists:
${lists}

Shopping list store layout (items are auto-sorted in this order when added):
${STORE_LAYOUT_SECTIONS.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`;
}
