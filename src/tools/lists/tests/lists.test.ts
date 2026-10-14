import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { config } from "../../../config.js";
import { callService, getTodoItems, moveTodoItems } from "../../../integrations/homeAssistant/client.js";
import type { TodoItem } from "../../../integrations/homeAssistant/schema.js";
import { addToList, sortList } from "../lists.js";

vi.mock("../../../integrations/homeAssistant/client.js", () => ({
  callService: vi.fn(),
  getAllStates: vi.fn(),
  getTodoItems: vi.fn(),
  moveTodoItems: vi.fn(),
}));

describe("manage_list replies", () => {
  const SHOPPING_LIST = config.ha.shoppingList;

  // An HA to-do list that keeps its items in order and applies service calls
  // and moves to them.
  let list: TodoItem[];
  let moveFails: boolean;

  beforeEach(() => {
    vi.mocked(getTodoItems).mockImplementation(async () => list.map(item => ({ ...item })));
    vi.mocked(callService).mockImplementation(async (_domain, service, data = {}) => {
      if (service !== "add_item") throw new Error(`unexpected service ${service}`);
      list.push({ uid: `uid-${String(data.item)}`, summary: String(data.item), status: "needs_action" });
    });
    vi.mocked(moveTodoItems).mockImplementation(async (_entityId, moves) => {
      if (moveFails) throw new Error("HA WebSocket: connection failed");
      for (const move of moves) {
        const item = list.splice(list.findIndex(i => i.uid === move.uid), 1)[0];
        const at = move.previousUid === undefined ? 0 : list.findIndex(i => i.uid === move.previousUid) + 1;
        list.splice(at, 0, item);
      }
    });
    moveFails = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function pendingSummaries(): string[] {
    return list.filter(i => i.status === "needs_action").map(i => i.summary);
  }

  it("adds new items to the shopping list and sorts it, without removing anything", async () => {
    list = [
      { uid: "uid-milk", summary: "milk", status: "needs_action" },
      { uid: "uid-beer", summary: "beer", status: "needs_action" },
    ];

    const reply = await addToList(SHOPPING_LIST, ["apples", "bread"]);

    expect(pendingSummaries()).toEqual(["apples", "milk", "bread", "beer"]);
    expect(vi.mocked(callService).mock.calls.map(call => call[1])).toEqual(["add_item", "add_item"]);
    expect(reply).toBe("Added apples, bread. List has 4 items sorted by store layout.");
  });

  it("keeps the added items and says so when sorting fails", async () => {
    list = [{ uid: "uid-beer", summary: "beer", status: "needs_action" }];
    moveFails = true;

    const reply = await addToList(SHOPPING_LIST, ["milk"]);

    expect(pendingSummaries()).toEqual(["beer", "milk"]);
    expect(reply).toBe("Added milk. List has 2 items, but sorting it failed: HA WebSocket: connection failed");
  });

  it("adds to another list without sorting it", async () => {
    list = [{ uid: "uid-milk", summary: "milk", status: "needs_action" }];

    const reply = await addToList("todo.chores", ["apples"]);

    expect(pendingSummaries()).toEqual(["milk", "apples"]);
    expect(moveTodoItems).not.toHaveBeenCalled();
    expect(reply).toBe("Added apples. List has 2 items.");
  });

  it("says how many items a sort put in order", async () => {
    list = [
      { uid: "uid-milk", summary: "milk", status: "needs_action" },
      { uid: "uid-soap", summary: "soap", status: "completed" },
    ];

    await expect(sortList(SHOPPING_LIST)).resolves.toBe("Sorted 1 items by store layout, 1 completed items alphabetically.");
  });

  it("says so when the list to sort is empty", async () => {
    list = [];

    await expect(sortList(SHOPPING_LIST)).resolves.toBe("List is empty.");
  });

  it("refuses to sort another list", async () => {
    list = [{ uid: "uid-milk", summary: "milk", status: "needs_action" }];

    await expect(sortList("todo.chores")).resolves.toBe("Only the shopping list is sorted.");
    expect(getTodoItems).not.toHaveBeenCalled();
  });
});
