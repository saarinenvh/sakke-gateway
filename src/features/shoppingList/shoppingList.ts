import { config } from "../../config.js";
import { getTodoItems, moveTodoItems } from "../../integrations/homeAssistant/client.js";
import type { TodoItem } from "../../integrations/homeAssistant/schema.js";
import { alphabetically, byStoreLayout, planMoves } from "./policy.js";
import { loadStoreLayout } from "./storeLayout.js";

// Keeps the shopping list in store order by moving its items in Home
// Assistant; nothing is removed, so a failure part-way loses nothing.

export interface SortedCounts {
  pending: number;
  completed: number;
}

export function isShoppingList(entityId: string): boolean {
  return entityId === config.ha.shoppingList;
}

// Pending items in store order, then completed ones alphabetically.
export async function sortShoppingList(entityId: string): Promise<SortedCounts> {
  const items = await getTodoItems(entityId);
  const pending = items.filter(i => i.status === "needs_action").sort(byStoreLayout(loadStoreLayout()));
  const completed = items.filter(i => i.status === "completed").sort(alphabetically);

  await moveInto(entityId, items, [...pending, ...completed]);

  return { pending: pending.length, completed: completed.length };
}

// After an add: new items land at the end and their uids are only known by
// reading the list back. Completed items stay where they are, so a long tail of
// them isn't moved on every add.
export async function sortPendingItems(entityId: string): Promise<void> {
  const pending = (await getTodoItems(entityId)).filter(i => i.status === "needs_action");
  const target = [...pending].sort(byStoreLayout(loadStoreLayout()));

  await moveInto(entityId, pending, target);
}

export function storeSections(): string[] {
  return loadStoreLayout().map(s => s.section);
}

async function moveInto(entityId: string, current: TodoItem[], target: TodoItem[]): Promise<void> {
  await moveTodoItems(entityId, planMoves(current.map(requireUid), target.map(requireUid)));
}

function requireUid(item: TodoItem): string {
  if (item.uid === undefined) throw new Error(`"${item.summary}" has no uid, so it can't be moved`);
  return item.uid;
}
