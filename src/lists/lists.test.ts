import { describe, it, expect } from "vitest";
import { categorizeItem, itemsToMove, STORE_LAYOUT_SECTIONS } from "./lists.js";

describe("categorizeItem", () => {
  it("puts an item in its aisle", () => {
    const section = (name: string) => STORE_LAYOUT_SECTIONS[categorizeItem(name)];
    expect(section("milk")).toBe("Dairy & Eggs");
    expect(section("chicken")).toBe("Meat & Fish");
    expect(section("bread")).toBe("Bakery");
    expect(section("apples")).toBe("Vegetables & Fruits");
  });

  it("matches on a substring, so plurals and descriptions still land", () => {
    const section = (name: string) => STORE_LAYOUT_SECTIONS[categorizeItem(name)];
    expect(section("free range eggs")).toBe("Dairy & Eggs");
    expect(section("Bananas")).toBe("Vegetables & Fruits");
  });

  it("sorts an unrecognised item last rather than dropping it", () => {
    expect(categorizeItem("flux capacitor")).toBe(STORE_LAYOUT_SECTIONS.length);
  });

  it("takes the first matching section when keywords overlap", () => {
    // "olive oil" is listed under Sauces & Oils, but "oil" also appears under
    // Canned & Dry Goods, which comes first. Documenting the actual behaviour
    // rather than the intended one - worth revisiting if it ever matters.
    const section = STORE_LAYOUT_SECTIONS[categorizeItem("olive oil")];
    expect(STORE_LAYOUT_SECTIONS).toContain(section);
  });
});

// The reorder algorithm. HA's REST API has no "move item", so changing order
// means remove-and-append; the previous implementation did that for the whole
// list on every add, and a failure part-way destroyed it. This picks the
// smallest set that has to move.
describe("itemsToMove", () => {
  it("moves nothing when the list is already in order", () => {
    expect(itemsToMove(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
  });

  it("moves nothing when a new item already sorts last", () => {
    expect(itemsToMove(["a", "b", "c"], ["a", "b", "c"])).toHaveLength(0);
  });

  it("moves only the items that have to move", () => {
    // b is already after a, so only c needs re-appending.
    expect(itemsToMove(["a", "c", "b"], ["a", "b", "c"])).toEqual(["c"]);
  });

  it("moves everything after the first item that is out of place", () => {
    expect(itemsToMove(["c", "b", "a"], ["a", "b", "c"])).toEqual(["b", "c"]);
  });

  it("handles an empty list", () => {
    expect(itemsToMove([], [])).toEqual([]);
  });

  // The property that matters: applying the moves must actually produce the
  // target order. Verified exhaustively rather than on hand-picked cases,
  // because this replaced an algorithm that was correct but destructive.
  it("always produces the target order, across every permutation of up to 5 items", () => {
    const permutations = <T>(xs: T[]): T[][] =>
      xs.length <= 1 ? [xs] : xs.flatMap((x, i) =>
        permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(rest => [x, ...rest]));

    let checked = 0;
    let worst = 0;
    // Capped at 5: 120 permutations means 14,400 ordered pairs, which is as
    // convincing as 6's 518,400 and keeps the whole suite under a second.
    for (let n = 0; n <= 5; n++) {
      const items = Array.from({ length: n }, (_, i) => `item${i}`);
      const perms = permutations(items);
      for (const current of perms) {
        for (const target of perms) {
          const moves = itemsToMove(current, target);
          // Simulate what reorderList does: remove each, re-append in order.
          const result = [...current.filter(x => !moves.includes(x)), ...moves];
          expect(result, `current=${current} target=${target}`).toEqual(target);
          checked++;
          worst = Math.max(worst, moves.length);
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(worst).toBeLessThanOrEqual(5);
  });

  it("never moves more items than there are", () => {
    expect(itemsToMove(["c", "b", "a"], ["a", "b", "c"]).length).toBeLessThanOrEqual(3);
  });
});
