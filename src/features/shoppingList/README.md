# Shopping list

Keeps the Home Assistant shopping list (`config.ha.shoppingList`) in the order
you walk through the store. Pending items go in store order, completed ones
alphabetically after them. It reorders by moving items over HA's WebSocket API
(`todo/item/move`), never by removing and re-adding them, so a failure
part-way leaves every item on the list.

The store order is read from the wiki on every use, so changing it is an
Obsidian edit rather than a deploy. Each `##` heading is a section, in walking
order, with comma-separated words under it. An item goes to the section of the
longest word its name contains ("ice cream" beats "cream"); a tie goes to the
earlier section, and an item matching none sorts last.

## Entry points

| Export | Called by |
| --- | --- |
| `isShoppingList(entityId)` | `tools/lists/lists.ts`, to sort only the shopping list |
| `sortShoppingList(entityId)` | `tools/lists/lists.ts`, for `list_sort`: the whole list, returns the counts |
| `sortPendingItems(entityId)` | `tools/lists/lists.ts`, after `list_add`: only the pending items, so the completed ones aren't moved on every add |
| `storeSections()` | `tools/lists/prompt.ts`, the section names for the system prompt |

## Data

None in the gateway. The list itself lives in Home Assistant. The store order
is the wiki page `home/context/store_layout.md`, or the bundled
`store_layout.md` when the wiki has none or the page has no sections. Switching
to the bundled copy logs a warning, and switching back to the wiki page logs an
info line. Each is logged only when the source changes, not on every turn.

## Files

| File | Does |
| --- | --- |
| `shoppingList.ts` | reads the list, works out the order, sends the moves |
| `policy.ts` | pure rules: `categorizeItem`, the sort orders, `planMoves` |
| `storeLayout.ts` | loads the store order from the wiki or the bundled copy, and parses it |
| `store_layout.md` | the bundled store order |
