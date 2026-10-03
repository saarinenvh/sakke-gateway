import { z } from "zod";

// Model → gateway: the arguments of a schedule tool call.

export const scheduleArgsExample = {
  action: "set",
  when: { in_minutes: 10 },
  label: "the pasta",
};

// A year out is the furthest anything is scheduled; it also keeps the due time
// inside the range a Date can hold.
const MAX_DELAY_MINUTES = 366 * 24 * 60;

// What the model is shown: one flat object, which reads more plainly than a
// union per action. scheduleRequestSchema holds what each action needs.
export const scheduleArgsSchema = z.object({
  action: z.enum(["set", "cancel", "list"]),
  when: z.object({
    in_minutes: z.coerce.number().describe("Minutes from now, e.g. 10, or 0.5 for thirty seconds."),
  }).optional().describe("For set: when it should happen."),
  label: z.string().optional()
    .describe("For set: what it's for, e.g. 'the pasta' or 'check the oven'. Announced when it's time."),
  job_id: z.string().optional()
    .describe("For cancel: the id from set or list, or part of the label. Leave out to cancel the only one."),
});

// run isn't offered to the model yet: announce is the only schedulable tool
// until Phase 3. Without it, the job announces its label.
const setRequestSchema = z.object({
  action: z.literal("set"),
  when: z.object({ in_minutes: z.coerce.number().positive().max(MAX_DELAY_MINUTES) }),
  label: z.string().trim().min(1),
  run: z.object({
    tool: z.string().trim().min(1),
    args: z.record(z.string(), z.unknown()).default({}),
  }).optional(),
});

export type SetRequest = z.output<typeof setRequestSchema>;

export const scheduleRequestSchema = z.discriminatedUnion("action", [
  setRequestSchema,
  z.object({ action: z.literal("cancel"), job_id: z.string().trim().min(1).optional() }),
  z.object({ action: z.literal("list") }),
]);
