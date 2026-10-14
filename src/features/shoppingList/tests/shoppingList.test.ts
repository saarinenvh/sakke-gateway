import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTodoItems, moveTodoItems } from "../../../integrations/homeAssistant/client.js";
import type { TodoItem } from "../../../integrations/homeAssistant/schema.js";
import { sortPendingItems, sortShoppingList } from "../shoppingList.js";

vi.mock("../../../integrations/homeAssistant/client.js", () => ({
  getTodoItems: vi.fn(),
  moveTodoItems: vi.fn(),
}));

const SHOPPING_LIST = "todo.shopping_list";

// An HA to-do list that keeps its items in order and applies moves to them the
// way todo/item/move does.
let list: TodoItem[];

beforeEach(() => {
  vi.mocked(getTodoItems).mockImplementation(async () => list.map(item => ({ ...item })));
  vi.mocked(moveTodoItems).mockImplementation(async (_entityId, moves) => {
    for (const move of moves) {
      const item = list.splice(list.findIndex(i => i.uid === move.uid), 1)[0];
      const at = move.previousUid === undefined ? 0 : list.findIndex(i => i.uid === move.previousUid) + 1;
      list.splice(at, 0, item);
    }
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function summaries(status: TodoItem["status"]): string[] {
  return list.filter(i => i.status === status).map(i => i.summary);
}

describe("sortShoppingList", () => {
  it("puts pending items in store order and completed ones alphabetically, keeping their fields", async () => {
    list = [
      { uid: "uid-milk", summary: "milk", status: "needs_action", due: "2026-10-20", description: "oat" },
      { uid: "uid-soap", summary: "soap", status: "completed" },
      { uid: "uid-apples", summary: "apples", status: "needs_action" },
      { uid: "uid-bread", summary: "bread", status: "completed" },
    ];

    await expect(sortShoppingList(SHOPPING_LIST)).resolves.toEqual({ pending: 2, completed: 2 });

    expect(summaries("needs_action")).toEqual(["apples", "milk"]);
    expect(summaries("completed")).toEqual(["bread", "soap"]);
    expect(list.find(i => i.uid === "uid-milk")).toMatchObject({ due: "2026-10-20", description: "oat" });
  });

  it("moves items with the same name by their own uid", async () => {
    list = [
      { uid: "uid-milk-1", summary: "milk", status: "needs_action" },
      { uid: "uid-apples", summary: "apples", status: "needs_action" },
      { uid: "uid-milk-2", summary: "milk", status: "needs_action" },
    ];

    await sortShoppingList(SHOPPING_LIST);

    expect(list.map(i => i.uid)).toEqual(["uid-apples", "uid-milk-1", "uid-milk-2"]);
  });

  it("doesn't sort an item it can't move by uid", async () => {
    list = [
      { summary: "milk", status: "needs_action" },
      { uid: "uid-apples", summary: "apples", status: "needs_action" },
    ];

    await expect(sortShoppingList(SHOPPING_LIST)).rejects.toThrow('"milk" has no uid');
    expect(moveTodoItems).not.toHaveBeenCalled();
  });
});

describe("sortPendingItems", () => {
  it("moves only the pending items, leaving completed ones out of the moves", async () => {
    list = [
      { uid: "uid-soap", summary: "soap", status: "completed" },
      { uid: "uid-milk", summary: "milk", status: "needs_action" },
      { uid: "uid-apples", summary: "apples", status: "needs_action" },
    ];

    await sortPendingItems(SHOPPING_LIST);

    expect(summaries("needs_action")).toEqual(["apples", "milk"]);
    const moved = vi.mocked(moveTodoItems).mock.calls[0][1].map(move => move.uid);
    expect(moved).toEqual(["uid-apples", "uid-milk"]);
  });
});
