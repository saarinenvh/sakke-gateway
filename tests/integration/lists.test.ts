import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startFakeHomeAssistant, type FakeHomeAssistant } from "../fixtures/fakeHomeAssistant.js";
import { addToList, sortList, readList, removeFromList, completeInList } from "../../src/tools/lists/lists.js";
import { reloadConfig } from "../../src/config.js";

// These tests run the real HTTP and WebSocket clients against a fake that keeps
// actual list state, so what survives a failure can be inspected rather than
// inferred.

const LIST = "todo.shopping_list";
let ha: FakeHomeAssistant;

beforeAll(async () => {
  ha = await startFakeHomeAssistant();
  process.env.HA_BASE_URL = ha.url;
  process.env.HA_TOKEN = "test-token";
  reloadConfig();
});

afterAll(async () => {
  await ha.close();
  delete process.env.HA_BASE_URL;
  delete process.env.HA_TOKEN;
  reloadConfig();
});

const pending = (...summaries: string[]) =>
  summaries.map(summary => ({ summary, status: "needs_action" as const }));

const summaries = () => ha.items(LIST).map(i => i.summary);

beforeEach(() => ha.setItems(LIST, []));

describe("addToList", () => {
  it("adds an item and sorts the list by aisle", async () => {
    ha.setItems(LIST, pending("bread", "apples"));
    await addToList(LIST, ["chicken"]);
    // Vegetables & Fruits, then Meat & Fish, then Bakery.
    expect(summaries()).toEqual(["apples", "chicken", "bread"]);
  });

  it("costs a single call when the new item already belongs at the end", async () => {
    ha.setItems(LIST, pending("apples", "chicken"));
    await addToList(LIST, ["bread"]);
    expect(ha.calls()).toEqual(["add_item:bread"]);
  });

  it("does not add a duplicate, whatever the casing", async () => {
    ha.setItems(LIST, pending("Milk"));
    const result = await addToList(LIST, ["milk"]);
    expect(summaries()).toEqual(["Milk"]);
    expect(result).toContain("already on the list");
  });

  it("adds several items at once", async () => {
    await addToList(LIST, ["bread", "milk", "apples"]);
    expect(summaries().sort()).toEqual(["apples", "bread", "milk"]);
  });
});

describe("when Home Assistant fails part-way through", () => {
  it("loses nothing", async () => {
    const original = ["water", "milk", "bread", "chicken", "apples", "soap"];
    ha.setItems(LIST, pending(...original));
    ha.failAfter(2);

    await expect(sortList(LIST)).rejects.toThrow();

    expect(summaries().sort()).toEqual([...original].sort());
  });

  it("keeps the added item and says the sort failed", async () => {
    ha.setItems(LIST, pending("water", "milk", "bread"));
    ha.failAfter(1);

    const result = await addToList(LIST, ["apples"]);

    expect(summaries().sort()).toEqual(["apples", "bread", "milk", "water"]);
    expect(result).toContain("sorting it failed");
  });
});

describe("sorting", () => {
  it("only moves items, never removes one", async () => {
    ha.setItems(LIST, pending("bread", "milk", "apples", "chicken"));

    await sortList(LIST);

    // Vegetables & Fruits, Meat & Fish, Dairy & Eggs, Bakery.
    expect(summaries()).toEqual(["apples", "chicken", "milk", "bread"]);
    expect(ha.calls().every(call => call.startsWith("move_item:"))).toBe(true);
  });

  it("keeps an item's due date, description and status", async () => {
    ha.setItems(LIST, [
      { summary: "soap", status: "needs_action" },
      { summary: "apples", status: "needs_action", due: "2026-09-30", description: "Granny Smith" },
      { summary: "bread", status: "completed" },
      { summary: "beer", status: "completed" },
    ]);

    await sortList(LIST);

    expect(ha.items(LIST).find(i => i.summary === "apples")).toMatchObject({ due: "2026-09-30", description: "Granny Smith" });
    expect(ha.items(LIST).filter(i => i.status === "completed").map(i => i.summary)).toEqual(["beer", "bread"]);
  });

  it("leaves other lists in the order they are", async () => {
    ha.setItems("todo.chores", pending("soap", "apples"));

    await addToList("todo.chores", ["bread"]);

    expect(ha.items("todo.chores").map(i => i.summary)).toEqual(["soap", "apples", "bread"]);
  });
});

describe("the other list operations", () => {
  it("reads back only pending items", async () => {
    ha.setItems(LIST, [
      { summary: "milk", status: "needs_action" },
      { summary: "bread", status: "completed" },
    ]);
    const text = await readList(LIST);
    expect(text).toContain("milk");
    expect(text).not.toContain("bread");
  });

  it("reports an empty list rather than nothing", async () => {
    expect(await readList(LIST)).toBe("List is empty.");
  });

  it("completes an item by partial name", async () => {
    ha.setItems(LIST, pending("oat milk"));
    await completeInList(LIST, "milk");
    expect(ha.items(LIST)[0].status).toBe("completed");
  });

  it("removes an item", async () => {
    ha.setItems(LIST, pending("milk", "bread"));
    await removeFromList(LIST, "milk");
    expect(summaries()).toEqual(["bread"]);
  });

  it("says so when an item to remove isn't there", async () => {
    ha.setItems(LIST, pending("milk"));
    expect(await removeFromList(LIST, "caviar")).toContain("Couldn't find");
  });
});
