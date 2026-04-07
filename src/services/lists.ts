const baseUrl = process.env.HA_BASE_URL ?? "http://localhost:8123";
const token = process.env.HA_TOKEN ?? "";

const STORE_LAYOUT = [
  { section: "Produce", keywords: ["apple", "banana", "orange", "grape", "berry", "lettuce", "tomato", "onion", "potato", "carrot", "cucumber", "pepper", "garlic", "lemon", "lime", "avocado", "mushroom", "spinach", "broccoli", "celery", "zucchini", "cabbage", "kale", "parsley", "basil", "dill", "ginger", "beetroot"] },
  { section: "Bakery", keywords: ["bread", "roll", "bun", "pastry", "cake", "muffin", "bagel", "croissant", "pita", "tortilla", "cracker"] },
  { section: "Meat & Fish", keywords: ["chicken", "beef", "pork", "lamb", "turkey", "fish", "salmon", "tuna", "shrimp", "prawn", "sausage", "bacon", "ham", "steak", "mince", "fillet", "crab", "herring", "meatball"] },
  { section: "Dairy & Eggs", keywords: ["milk", "cheese", "yogurt", "yoghurt", "butter", "cream", "egg", "sour cream", "cottage", "kefir", "quark", "curd", "oat milk", "oatmilk"] },
  { section: "Frozen", keywords: ["frozen", "ice cream", "gelato"] },
  { section: "Canned & Dry Goods", keywords: ["can", "pasta", "rice", "flour", "sugar", "oil", "sauce", "soup", "beans", "lentil", "cereal", "oat", "noodle", "stock", "broth", "vinegar", "salt", "spice", "honey", "jam", "peanut butter", "mustard", "ketchup", "mayo", "mayonnaise"] },
  { section: "Drinks", keywords: ["water", "juice", "soda", "beer", "wine", "coffee", "tea", "cola", "drink", "sparkling"] },
  { section: "Household & Cleaning", keywords: ["soap", "shampoo", "detergent", "cleaner", "tissue", "toilet paper", "paper towel", "laundry", "dishwasher", "conditioner", "toothpaste", "toothbrush", "deodorant", "razor"] },
];

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
}

async function haPost(path: string, body: object): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
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

export async function getTodoLists(): Promise<{ entity_id: string; name: string }[]> {
  const res = await fetch(`${baseUrl}/api/states`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];
  const states = await res.json() as { entity_id: string; attributes: { friendly_name?: string } }[];
  return states
    .filter(s => s.entity_id.startsWith("todo."))
    .map(s => ({ entity_id: s.entity_id, name: s.attributes.friendly_name ?? s.entity_id }));
}

export async function readList(entityId: string): Promise<string> {
  const items = await getItems(entityId);
  const pending = items.filter(i => i.status === "needs_action");
  if (pending.length === 0) return "List is empty.";
  return pending.map(i => `- ${i.summary}`).join("\n");
}

export async function addToList(entityId: string, newItems: string[]): Promise<string> {
  const existing = await getItems(entityId);
  const incomplete = existing.filter(i => i.status === "needs_action").map(i => i.summary);

  const merged = [...incomplete];
  for (const item of newItems) {
    if (!merged.some(e => e.toLowerCase() === item.toLowerCase())) {
      merged.push(item);
    }
  }

  merged.sort((a, b) => categorizeItem(a) - categorizeItem(b));

  for (const item of incomplete) {
    await haPost("/api/services/todo/remove_item", { entity_id: entityId, item });
  }
  for (const item of merged) {
    await haPost("/api/services/todo/add_item", { entity_id: entityId, item });
  }

  return `Added ${newItems.join(", ")}. List has ${merged.length} items sorted by store layout.`;
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
