import { isShoppingList, sortPendingItems, sortShoppingList } from "../../features/shoppingList/shoppingList.js";
import { callService, getAllStates, getTodoItems } from "../../integrations/homeAssistant/client.js";
import type { TodoItem } from "../../integrations/homeAssistant/schema.js";

export async function getTodoLists(): Promise<{ entity_id: string; name: string }[]> {
  const states = await getAllStates({ timeoutMs: 5000 });
  return states
    .filter(s => s.entity_id.startsWith("todo."))
    .map(s => ({ entity_id: s.entity_id, name: s.attributes.friendly_name ?? s.entity_id }));
}

export async function sortList(entityId: string): Promise<string> {
  if (!isShoppingList(entityId)) return "Only the shopping list is sorted.";

  const { pending, completed } = await sortShoppingList(entityId);
  if (pending + completed === 0) return "List is empty.";

  return `Sorted ${pending} items by store layout, ${completed} completed items alphabetically.`;
}

export async function readList(entityId: string): Promise<string> {
  const items = await getTodoItems(entityId);
  const pending = items.filter(i => i.status === "needs_action");
  if (pending.length === 0) return "List is empty.";
  return pending.map(i => `- ${i.summary}`).join("\n");
}

export async function addToList(entityId: string, newItems: string[]): Promise<string> {
  const pending = (await getTodoItems(entityId)).filter(i => i.status === "needs_action");
  const toAdd = newItems.filter(
    item => !pending.some(existing => existing.summary.toLowerCase() === item.toLowerCase()),
  );

  for (const item of toAdd) {
    await callService("todo", "add_item", { entity_id: entityId, item });
  }

  const lead = toAdd.length > 0
    ? `Added ${toAdd.join(", ")}.`
    : `${newItems.join(", ")} already on the list.`;
  const count = pending.length + toAdd.length;
  if (!isShoppingList(entityId)) return `${lead} List has ${count} items.`;

  try {
    await sortPendingItems(entityId);
  } catch (err) {
    return `${lead} List has ${count} items, but sorting it failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  return `${lead} List has ${count} items sorted by store layout.`;
}

export async function completeInList(entityId: string, itemQuery: string): Promise<string> {
  const items = await getTodoItems(entityId);
  const match = findItem(items.filter(i => i.status === "needs_action"), itemQuery);
  if (!match) return `Couldn't find "${itemQuery}" in the list.`;
  await callService("todo", "update_item", { entity_id: entityId, item: match.summary, status: "completed" });
  return `Marked "${match.summary}" as done.`;
}

export async function removeFromList(entityId: string, itemQuery: string): Promise<string> {
  const items = await getTodoItems(entityId);
  const match = findItem(items, itemQuery);
  if (!match) return `Couldn't find "${itemQuery}" in the list.`;
  await callService("todo", "remove_item", { entity_id: entityId, item: match.summary });
  return `Removed "${match.summary}".`;
}

function findItem(items: TodoItem[], query: string): TodoItem | undefined {
  const lower = query.toLowerCase();
  return (
    items.find(i => i.summary.toLowerCase() === lower) ??
    items.find(i => i.summary.toLowerCase().includes(lower)) ??
    items.find(i => lower.includes(i.summary.toLowerCase()))
  );
}
