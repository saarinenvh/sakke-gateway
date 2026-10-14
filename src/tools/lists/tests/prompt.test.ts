import { describe, it, expect, vi, afterEach } from "vitest";
import { storeSections } from "../../../features/shoppingList/shoppingList.js";
import { getTodoLists } from "../lists.js";
import { listsPrompt } from "../prompt.js";

vi.mock("../../../features/shoppingList/shoppingList.js", () => ({ storeSections: vi.fn() }));
vi.mock("../lists.js", () => ({ getTodoLists: vi.fn() }));

afterEach(() => {
  vi.resetAllMocks();
});

describe("listsPrompt", () => {
  it("lists the to-do lists and the store sections in order", async () => {
    vi.mocked(getTodoLists).mockResolvedValue([{ entity_id: "todo.shopping_list", name: "Shopping" }]);
    vi.mocked(storeSections).mockReturnValue(["Vegetables", "Dairy"]);

    const prompt = await listsPrompt();

    expect(prompt).toContain("  - Shopping (todo.shopping_list)");
    expect(prompt).toContain("  1. Vegetables\n  2. Dairy");
  });

  it("still builds when neither HA nor the store layout can be read", async () => {
    vi.mocked(getTodoLists).mockRejectedValue(new Error("HA unreachable"));
    vi.mocked(storeSections).mockImplementation(() => {
      throw new Error("ENOENT: store_layout.md");
    });

    const prompt = await listsPrompt();

    expect(prompt).toContain("(unable to load lists right now)");
    expect(prompt).toContain("(store layout unavailable right now)");
  });
});
