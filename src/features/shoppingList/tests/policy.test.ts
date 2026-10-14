import { describe, it, expect } from "vitest";
import type { TodoMove } from "../../../integrations/homeAssistant/client.js";
import { categorizeItem, planMoves } from "../policy.js";
import { parseStoreLayout } from "../storeLayout.js";

describe("categorizeItem", () => {
  const layout = parseStoreLayout([
    "## Vegetables", "apple, banana",
    "## Canned", "oil, oat, can",
    "## Sauces & Oils", "olive oil",
    "## Coffee & Tea", "tea",
    "## Meat", "steak",
    "## Dairy", "milk, egg, cream, oat milk",
    "## Toys", "ball",
    "## Sports", "ball",
    "## Frozen", "ice cream",
  ].join("\n"));
  const section = (name: string) => layout[categorizeItem(name, layout)]?.section;

  it("matches on a substring, ignoring case, so plurals and descriptions still land", () => {
    expect(section("Bananas")).toBe("Vegetables");
    expect(section("free range eggs")).toBe("Dairy");
  });

  it("takes the section of the longest matching keyword", () => {
    expect(section("olive oil")).toBe("Sauces & Oils");
    expect(section("ice cream")).toBe("Frozen");
    expect(section("oat milk")).toBe("Dairy");
    expect(section("pork steak")).toBe("Meat");
  });

  it("takes the earlier section when the longest keywords are as long", () => {
    expect(section("beach ball")).toBe("Toys");
  });

  it("sorts an unrecognised item after every section", () => {
    expect(categorizeItem("flux capacitor", layout)).toBe(layout.length);
  });
});

describe("planMoves", () => {
  it("moves nothing when the list is already in order", () => {
    expect(planMoves(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
  });

  it("moves the first item to the top and every other one after the item before it", () => {
    expect(planMoves(["a", "c", "b"], ["a", "b", "c"])).toEqual([
      { uid: "a", previousUid: undefined },
      { uid: "b", previousUid: "a" },
      { uid: "c", previousUid: "b" },
    ]);
  });

  it("handles an empty list", () => {
    expect(planMoves([], [])).toEqual([]);
  });

  // Applies the moves the way HA's todo/item/move does: the item is taken out
  // and put right after previousUid, or at the top without one.
  function applyMoves(list: string[], moves: TodoMove[]): string[] {
    const result = [...list];
    for (const move of moves) {
      result.splice(result.indexOf(move.uid), 1);
      const at = move.previousUid === undefined ? 0 : result.indexOf(move.previousUid) + 1;
      result.splice(at, 0, move.uid);
    }
    return result;
  }

  it("always produces the target order, across every permutation of up to 5 items", () => {
    const permutations = <T>(xs: T[]): T[][] =>
      xs.length <= 1 ? [xs] : xs.flatMap((x, i) =>
        permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(rest => [x, ...rest]));

    let checked = 0;
    // Capped at 5: 120 permutations means 14,400 ordered pairs, which is as
    // convincing as 6's 518,400 and keeps the whole suite under a second.
    for (let n = 0; n <= 5; n++) {
      const items = Array.from({ length: n }, (_, i) => `item${i}`);
      const perms = permutations(items);
      for (const current of perms) {
        for (const target of perms) {
          const moves = planMoves(current, target);
          expect(applyMoves(current, moves), `current=${current} target=${target}`).toEqual(target);
          expect(moves.length).toBeLessThanOrEqual(n);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
