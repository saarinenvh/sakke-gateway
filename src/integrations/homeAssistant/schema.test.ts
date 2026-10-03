import { describe, it, expect } from "vitest";
import { parseOrThrow } from "../../util/validation.js";
import {
  calendarEventsExample,
  calendarEventsSchema,
  entityStateExample,
  entityStateSchema,
  entityStatesSchema,
  serviceResponseEnvelopeSchema,
  stateHistoryExample,
  stateHistorySchema,
  todoGetItemsResponseExample,
  todoGetItemsResponseSchemaFor,
} from "./schema.js";

describe("Home Assistant boundary schemas", () => {
  it("accept their examples", () => {
    parseOrThrow(entityStateSchema, entityStateExample, "HA entity state example");
    parseOrThrow(entityStatesSchema, [entityStateExample], "HA entity states example");
    parseOrThrow(stateHistorySchema, stateHistoryExample, "HA state history example");
    parseOrThrow(serviceResponseEnvelopeSchema, todoGetItemsResponseExample, "HA service response envelope example");
    parseOrThrow(
      todoGetItemsResponseSchemaFor("todo.shopping_list"),
      todoGetItemsResponseExample.service_response,
      "HA todo.get_items example",
    );
    parseOrThrow(calendarEventsSchema, calendarEventsExample, "HA calendar events example");
  });
});

describe("calendarEventsSchema", () => {
  it.each([
    ["no start value at all", { summary: "x", start: {} }],
    ["an unparseable dateTime", { summary: "x", start: { dateTime: "tomorrow-ish" } }],
  ])("rejects an event with %s", (_case, event) => {
    expect(calendarEventsSchema.safeParse([event]).success).toBe(false);
  });
});
