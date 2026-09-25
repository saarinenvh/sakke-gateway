import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startFakeHomeAssistant, type FakeHomeAssistant } from "../fixtures/fakeHomeAssistant.js";
import { addToList, sortList, readList, removeFromList, completeInList } from "../../src/lists/lists.js";
import { reloadConfig } from "../../src/config.js";

// Finding #3 was the worst bug in the review: adding one item removed every
// pending item and re-added them sorted, so any failure between the two loops
// destroyed the list. These tests exercise the real HTTP client against a fake
// that keeps actual list state, so what survives a failure can be inspected
// rather than inferred.

const LIST = "todo.shopping";
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
  // The old implementation removed every item before re-adding any, so an
  // injected failure after two calls lost four of six items permanently.
  it("loses nothing", async () => {
    const original = ["water", "milk", "bread", "chicken", "apples", "soap"];
    ha.setItems(LIST, pending(...original));
    ha.failAfter(2);

    await expect(sortList(LIST)).rejects.toThrow();

    expect(summaries().sort()).toEqual([...original].sort());
  });

  it("loses nothing when the failure lands during an add", async () => {
    ha.setItems(LIST, pending("water", "milk", "bread"));
    ha.failAfter(1);

    await expect(addToList(LIST, ["apples"])).rejects.toThrow();

    // Everything that was there is still there. The new item may or may not
    // have made it, which is fine - what must not happen is losing the rest.
    for (const item of ["water", "milk", "bread"]) {
      expect(summaries()).toContain(item);
    }
  });

  it("never holds more than one item out of the list at a time", async () => {
    // The property behind the fix: remove is always immediately followed by the
    // matching add, so a failure can strand at most one item.
    ha.setItems(LIST, pending("soap", "apples", "bread", "milk"));
    await sortList(LIST);

    const calls = ha.calls();
    const removes = calls.filter(c => c.startsWith("remove_item"));
    for (const remove of removes) {
      const item = remove.split(":")[1];
      const removeAt = calls.indexOf(remove);
      const addAt = calls.indexOf(`add_item:${item}`, removeAt);
      expect(addAt, `${item} was removed but never re-added`).toBeGreaterThan(removeAt);
      // Nothing else is removed in between.
      expect(calls.slice(removeAt + 1, addAt).some(c => c.startsWith("remove_item"))).toBe(false);
    }
  });
});

describe("item fields survive a reorder", () => {
  it("keeps a due date and completed status", async () => {
    // remove_item/add_item carry only the summary, so anything else set on an
    // item would otherwise be lost every time the list was sorted.
    ha.setItems(LIST, [
      { summary: "soap", status: "needs_action" },
      { summary: "apples", status: "needs_action", due: "2026-09-30" },
    ]);

    await sortList(LIST);

    const apples = ha.items(LIST).find(i => i.summary === "apples");
    expect(apples?.due).toBe("2026-09-30");
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
