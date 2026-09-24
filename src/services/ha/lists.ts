import { config } from "../../config.js";

const STORE_LAYOUT = [
  { section: "Electronics & Household", keywords: ["battery", "bulb", "cable", "charger", "adapter", "tape", "glue", "pen", "bag", "wrap", "foil", "candle", "match", "lighter"] },
  { section: "Cleaning & Hygiene", keywords: ["soap", "shampoo", "detergent", "cleaner", "tissue", "toilet paper", "paper towel", "laundry", "dishwasher", "conditioner", "toothpaste", "toothbrush", "deodorant", "razor", "sponge", "bleach", "rinse"] },
  { section: "Vegetables & Fruits", keywords: ["apple", "banana", "orange", "grape", "berry", "lettuce", "tomato", "onion", "potato", "carrot", "cucumber", "pepper", "garlic", "lemon", "lime", "avocado", "mushroom", "spinach", "broccoli", "celery", "zucchini", "cabbage", "kale", "parsley", "basil", "dill", "ginger", "beetroot", "strawberry", "blueberry", "raspberry", "pear", "peach", "mango"] },
  { section: "Canned & Dry Goods", keywords: ["can", "pasta", "rice", "flour", "oil", "soup", "beans", "lentil", "cereal", "oat", "noodle", "stock", "broth", "vinegar", "salt", "spice", "honey", "jam", "peanut butter", "canned", "dried"] },
  { section: "Sauces & Oils", keywords: ["olive oil", "mustard", "ketchup", "mayo", "mayonnaise", "sauce", "dressing", "salsa", "pesto", "relish", "sriracha", "tabasco"] },
  { section: "Coffee, Tea & Sugar", keywords: ["coffee", "tea", "sugar", "sweetener", "cocoa", "espresso", "latte", "cappuccino"] },
  { section: "Juices", keywords: ["juice", "smoothie", "nectar", "lemonade", "squash"] },
  { section: "Convenience & Ready Meals", keywords: ["ready meal", "ready-meal", "pizza", "lasagna", "lasagne", "wrap", "sandwich", "sushi", "salad", "hummus", "dip", "snack", "crisp", "chip", "nut", "dried fruit"] },
  { section: "Meat & Fish", keywords: ["chicken", "beef", "pork", "lamb", "turkey", "fish", "salmon", "tuna", "shrimp", "prawn", "sausage", "bacon", "ham", "steak", "mince", "fillet", "crab", "herring", "meatball", "minced", "poultry"] },
  { section: "Dairy & Eggs", keywords: ["milk", "cheese", "yogurt", "yoghurt", "butter", "cream", "egg", "sour cream", "cottage", "kefir", "quark", "curd", "oat milk", "oatmilk"] },
  { section: "Bakery", keywords: ["bread", "roll", "bun", "pastry", "cake", "muffin", "bagel", "croissant", "pita", "tortilla", "cracker", "rye", "sourdough"] },
  { section: "Drinks", keywords: ["water", "soda", "beer", "wine", "cola", "sparkling", "cider", "energy drink", "isotonic"] },
  { section: "Frozen", keywords: ["frozen", "ice cream", "gelato", "freeze"] },
];

export const STORE_LAYOUT_SECTIONS = STORE_LAYOUT.map(s => s.section);

function categorizeItem(name: string): number {
  const lower = name.toLowerCase();
  for (let i = 0; i < STORE_LAYOUT.length; i++) {
    if (STORE_LAYOUT[i].keywords.some(kw => lower.includes(kw))) return i;
  }
  return STORE_LAYOUT.length;
}

interface TodoItem {
  uid?: string;
  summary: string;
  status: "needs_action" | "completed";
  due?: string;
  description?: string;
}

async function haPost(path: string, body: object): Promise<any> {
  const res = await fetch(`${config.ha.baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.ha.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HA ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getItems(entityId: string): Promise<TodoItem[]> {
  const data = await haPost(`/api/services/todo/get_items?return_response=true`, { entity_id: entityId });
  const root = data?.service_response ?? data;
  return (root[entityId]?.items ?? []) as TodoItem[];
}

function findItem(items: TodoItem[], query: string): TodoItem | undefined {
  const lower = query.toLowerCase();
  return (
    items.find(i => i.summary.toLowerCase() === lower) ??
    items.find(i => i.summary.toLowerCase().includes(lower)) ??
    items.find(i => lower.includes(i.summary.toLowerCase()))
  );
}

// HA's REST service API has no "reorder item" call, so putting a list into a
// given order means removing items and re-adding them (which appends). The
// previous implementation did that for EVERY item on every single add: it
// removed the whole list, then re-added it sorted. Any failure between those
// two loops - an HA restart, the 10s timeout above, a network blip - destroyed
// the entire list permanently.
//
// Instead, only the items that genuinely have to move are touched, and each is
// removed and immediately re-added on its own, so at most one item is ever in
// flight. The items that can stay put are the longest prefix of the target
// order that already appears as a subsequence of the current order; everything
// from there on gets re-appended in target order.
//
// Common cases cost nothing at all: a list that's already sorted, or a new item
// whose section sorts last, produce zero moves.
function itemsToMove(current: string[], target: string[]): string[] {
  let kept = 0;
  for (const summary of current) {
    if (kept < target.length && target[kept] === summary) kept++;
  }
  return target.slice(kept);
}

// remove_item/add_item only carry the summary, so a reorder would otherwise
// silently drop anything else set on the item - a due date added in the HA UI,
// a description synced from Google Tasks. Restored best-effort: the item itself
// already exists again by this point, so a failure here costs a field, never
// the item. A completed item also has to be re-marked completed, since it comes
// back as needs_action.
async function restoreItemFields(entityId: string, item: TodoItem | undefined): Promise<void> {
  if (!item) return;

  const fields: Record<string, unknown> = {};
  if (item.status === "completed") fields.status = "completed";
  if (item.due) fields[item.due.includes("T") ? "due_datetime" : "due_date"] = item.due;
  if (item.description) fields.description = item.description;
  if (Object.keys(fields).length === 0) return;

  try {
    await haPost("/api/services/todo/update_item", { entity_id: entityId, item: item.summary, ...fields });
  } catch {
    // Not every todo integration supports every field (Google Tasks and
    // local_todo differ), and a rejected optional field must not take the
    // whole list operation down with it.
  }
}

async function reorderList(entityId: string, items: TodoItem[], current: string[], target: string[]): Promise<number> {
  const moves = itemsToMove(current, target);
  if (moves.length === 0) return 0;

  const bySummary = new Map(items.map(i => [i.summary, i]));
  for (const summary of moves) {
    await haPost("/api/services/todo/remove_item", { entity_id: entityId, item: summary });
    await haPost("/api/services/todo/add_item", { entity_id: entityId, item: summary });
    await restoreItemFields(entityId, bySummary.get(summary));
  }
  return moves.length;
}

export async function getTodoLists(): Promise<{ entity_id: string; name: string }[]> {
  const res = await fetch(`${config.ha.baseUrl}/api/states`, {
    headers: { Authorization: `Bearer ${config.ha.token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];
  const states = await res.json() as { entity_id: string; attributes: { friendly_name?: string } }[];
  return states
    .filter(s => s.entity_id.startsWith("todo."))
    .map(s => ({ entity_id: s.entity_id, name: s.attributes.friendly_name ?? s.entity_id }));
}

export async function sortList(entityId: string): Promise<string> {
  const items = await getItems(entityId);
  const pending = items.filter(i => i.status === "needs_action");
  const completed = items.filter(i => i.status === "completed");

  if (pending.length === 0 && completed.length === 0) return "List is empty.";

  const currentPending = pending.map(i => i.summary);
  const targetPending = [...currentPending].sort((a, b) => categorizeItem(a) - categorizeItem(b));
  await reorderList(entityId, pending, currentPending, targetPending);

  const currentCompleted = completed.map(i => i.summary);
  const targetCompleted = [...currentCompleted].sort((a, b) => a.localeCompare(b));
  await reorderList(entityId, completed, currentCompleted, targetCompleted);

  return `Sorted ${targetPending.length} items by store layout, ${targetCompleted.length} completed items alphabetically.`;
}

export async function readList(entityId: string): Promise<string> {
  const items = await getItems(entityId);
  const pending = items.filter(i => i.status === "needs_action");
  if (pending.length === 0) return "List is empty.";
  return pending.map(i => `- ${i.summary}`).join("\n");
}

export async function addToList(entityId: string, newItems: string[]): Promise<string> {
  const existing = await getItems(entityId);
  const pending = existing.filter(i => i.status === "needs_action");
  const currentSummaries = pending.map(i => i.summary);

  const toAdd = newItems.filter(
    item => !currentSummaries.some(e => e.toLowerCase() === item.toLowerCase()),
  );

  // Add first, so the new items exist even if the reorder below fails partway.
  for (const item of toAdd) {
    await haPost("/api/services/todo/add_item", { entity_id: entityId, item });
  }

  // New items land at the end of the list; only re-sort if that isn't already
  // where they belong. Array.sort is stable, so items in the same section keep
  // their existing relative order and don't get moved for nothing.
  const current = [...currentSummaries, ...toAdd];
  const target = [...current].sort((a, b) => categorizeItem(a) - categorizeItem(b));
  const added = toAdd.map(item => ({ summary: item, status: "needs_action" as const }));
  await reorderList(entityId, [...pending, ...added], current, target);

  const lead = toAdd.length > 0
    ? `Added ${toAdd.join(", ")}.`
    : `${newItems.join(", ")} already on the list.`;
  return `${lead} List has ${current.length} items sorted by store layout.`;
}

export async function completeInList(entityId: string, itemQuery: string): Promise<string> {
  const items = await getItems(entityId);
  const match = findItem(items.filter(i => i.status === "needs_action"), itemQuery);
  if (!match) return `Couldn't find "${itemQuery}" in the list.`;
  await haPost("/api/services/todo/update_item", { entity_id: entityId, item: match.summary, status: "completed" });
  return `Marked "${match.summary}" as done.`;
}

export async function removeFromList(entityId: string, itemQuery: string): Promise<string> {
  const items = await getItems(entityId);
  const match = findItem(items, itemQuery);
  if (!match) return `Couldn't find "${itemQuery}" in the list.`;
  await haPost("/api/services/todo/remove_item", { entity_id: entityId, item: match.summary });
  return `Removed "${match.summary}".`;
}
