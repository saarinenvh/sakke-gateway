import type { TodoMove } from "../../integrations/homeAssistant/client.js";
import type { TodoItem } from "../../integrations/homeAssistant/schema.js";
import type { StoreSection } from "./storeLayout.js";

// The section of the longest keyword the name contains, so "ice cream" goes to
// Frozen rather than to "cream", and "steak" to meat rather than to "tea". A
// tie goes to the earlier section; a name that matches none sorts after every
// section.
export function categorizeItem(name: string, layout: StoreSection[]): number {
  const lower = name.toLowerCase();
  let best = { index: layout.length, keywordLength: 0 };

  for (const [index, section] of layout.entries()) {
    for (const keyword of section.keywords) {
      if (keyword.length > best.keywordLength && lower.includes(keyword)) best = { index, keywordLength: keyword.length };
    }
  }

  return best.index;
}

// Array.sort is stable, so items in the same section keep their order.
export function byStoreLayout(layout: StoreSection[]): (a: TodoItem, b: TodoItem) => number {
  return (a, b) => categorizeItem(a.summary, layout) - categorizeItem(b.summary, layout);
}

export function alphabetically(a: TodoItem, b: TodoItem): number {
  return a.summary.localeCompare(b.summary);
}

// The first item moves to the top and every other one to right after the item
// before it. A list already in order is left alone.
export function planMoves(currentUids: string[], targetUids: string[]): TodoMove[] {
  if (currentUids.every((uid, index) => uid === targetUids[index])) return [];
  return targetUids.map((uid, index) => ({ uid, previousUid: index > 0 ? targetUids[index - 1] : undefined }));
}
