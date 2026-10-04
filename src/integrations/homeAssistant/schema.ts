import { z } from "zod";

// HA → gateway, the answers to the gateway's REST calls (homeAssistant/client.ts).
// Zod strips undeclared fields, so a new HA field can't leak into the domain
// types by accident.

// GET /api/states/<entity_id>; GET /api/states answers an array of these.
export const entityStateExample = {
  entity_id: "light.living_room",
  state: "on",
  // Attributes vary per domain and are passed through as they are.
  attributes: {
    min_color_temp_kelvin: 2000,
    max_color_temp_kelvin: 6535,
    supported_color_modes: ["color_temp", "xy"],
    color_mode: "color_temp",
    brightness: 180,
    color_temp_kelvin: 3000,
    friendly_name: "Living room",
    supported_features: 40,
  },
  last_changed: "2026-10-03T06:12:41.118254+00:00",
  last_reported: "2026-10-03T06:12:41.118254+00:00", // ignored
  last_updated: "2026-10-03T06:12:41.118254+00:00", // ignored
  context: { id: "01J9ZQ4K7XH2Y8M3N5P6R7S8T9", parent_id: null, user_id: null }, // ignored
};

export const entityStateSchema = z.object({
  entity_id: z.string(),
  state: z.string(),
  // friendly_name is the one attribute every caller reads.
  attributes: z.looseObject({ friendly_name: z.string().optional() }),
  // Lets a vacuum run be timed correctly across a gateway restart.
  last_changed: z.string().optional(),
});

export type EntityState = z.output<typeof entityStateSchema>;

export const entityStatesSchema = z.array(entityStateSchema);

// GET /api/history/period/<start>?filter_entity_id=…&minimal_response&no_attributes:
// one list per entity, oldest first. Only the first entry of a list is a full state.
export const stateHistoryExample = [
  [
    {
      entity_id: "vacuum.robot", // ignored
      state: "docked",
      attributes: {}, // ignored
      last_changed: "2026-10-03T05:00:00+00:00",
      last_updated: "2026-10-03T05:00:00+00:00", // ignored
    },
    { state: "cleaning", last_changed: "2026-10-03T08:15:02.481233+00:00" },
    { state: "returning", last_changed: "2026-10-03T09:02:47.902114+00:00" },
    { state: "docked", last_changed: "2026-10-03T09:04:10.553870+00:00" },
  ],
];

export const stateHistorySchema = z.array(z.array(z.object({ state: z.string(), last_changed: z.string() })));

// POST /api/services/todo/get_items?return_response=true. Newer HA versions
// wrap a service's data as { changed_states, service_response }; older ones
// return the data bare.
export const todoGetItemsResponseExample = {
  changed_states: [], // ignored
  service_response: {
    "todo.shopping_list": {
      items: [
        { summary: "Oat milk", uid: "5c1f0b2e-7d4a-4e8b-9f3c-2a6d8e1b4c70", status: "needs_action" },
        {
          summary: "Return library books",
          uid: "a83e9d14-2b6c-4f71-8e05-c9d7b3f2a611",
          status: "needs_action",
          due: "2026-10-05",
          description: "Two books",
        },
        { summary: "Batteries", uid: "e4b27c90-1f3d-4a58-b6e2-7d0c9a8f5b33", status: "completed" },
      ],
    },
  },
};

export const serviceResponseEnvelopeSchema = z.object({
  service_response: z.record(z.string(), z.unknown()),
});

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

// The answer is keyed by entity id. The entity asked about must be in it - a
// missing one is a malformed response, not an empty list.
export function todoGetItemsResponseSchemaFor(entityId: string) {
  return z.object({ [entityId]: todoItemsSchema });
}

// GET /api/calendars/<entity_id>?start=…&end=…
export const calendarEventsExample = [
  {
    start: { dateTime: "2026-10-03T10:00:00+03:00" },
    end: { dateTime: "2026-10-03T11:00:00+03:00" }, // ignored
    summary: "Dentist",
    description: "Bring the referral", // ignored
    location: "Main Street 1", // ignored
    uid: "3f8a1c2e9b7d@google.com", // ignored
    recurrence_id: null, // ignored
    rrule: null, // ignored
  },
  {
    start: { date: "2026-10-04" },
    end: { date: "2026-10-05" }, // ignored
    summary: "Holiday",
    description: null, // ignored
    location: null, // ignored
    uid: "7c2d4e6f8a0b@google.com", // ignored
    recurrence_id: null, // ignored
    rrule: null, // ignored
  },
];

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
