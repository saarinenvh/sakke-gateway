import { z } from "zod";

// Model → gateway: the arguments of a manage_list tool call.

export const manageListArgsExample = {
  action: "list_add",
  list: "todo.groceries",
  items: ["milk", "eggs"],
  item: "bread",
};

export const manageListArgsSchema = z.object({
  action: z.enum(["list_read", "list_add", "list_complete", "list_remove", "list_sort"]),
  list: z.string().describe("Entity ID of the list, e.g. todo.groceries"),
  items: z.array(z.string()).describe("Items to add (for list_add)").optional(),
  item: z.string().describe("Item name to complete or remove").optional(),
});
