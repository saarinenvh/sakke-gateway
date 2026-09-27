import { z } from "zod";

// The shapes this service reads back from Home Assistant. Only the fields
// something actually uses are declared; Zod strips the rest, so a new HA
// attribute can't leak into the domain types by accident.

export const entityStateSchema = z.object({
  entity_id: z.string(),
  state: z.string(),
  // Attributes vary per domain; friendly_name is the one every caller reads.
  attributes: z.looseObject({ friendly_name: z.string().optional() }),
});

export type EntityState = z.output<typeof entityStateSchema>;

export const entityStatesSchema = z.array(entityStateSchema);

export const todoItemSchema = z.object({
  uid: z.string().optional(),
  summary: z.string(),
  status: z.enum(["needs_action", "completed"]),
  due: z.string().optional(),
  description: z.string().optional(),
});

export type TodoItem = z.output<typeof todoItemSchema>;

// One entity's entry in a todo.get_items answer.
export const todoItemsSchema = z.object({ items: z.array(todoItemSchema) });

const parseableDate = z.string().refine(value => !Number.isNaN(Date.parse(value)), {
  error: "must be a parseable date",
});

// A timed event carries dateTime, an all-day event carries date - one of the
// two is always there.
const calendarEventStartSchema = z.union([
  z.object({ dateTime: parseableDate }),
  z.object({ date: parseableDate }),
]);

export const calendarEventsSchema = z.array(
  z.object({
    summary: z.string(),
    start: calendarEventStartSchema,
  }),
);

export type CalendarEvent = z.output<typeof calendarEventsSchema>[number];
