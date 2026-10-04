import { z } from "zod";
import { modelNumber } from "../parameters.js";
import { CLOCK_DAYS, MERIDIEMS, type ClockTime } from "../../features/scheduling/policy.js";

// Model → gateway: the arguments of a schedule tool call.

export const scheduleArgsExample = {
  action: "set",
  when: { in_minutes: 10 },
  label: "the pasta",
};

export const scheduleArgsRunExample = {
  action: "set",
  when: { at: { hour: 11, meridiem: "am" } },
  label: "start the vacuum",
  run: { tool: "vacuum", args: { action: "start" } },
};

// The tools the model may name in run: those that can run unattended, other
// than announce, which is what a job without run does anyway.
export const RUNNABLE_TOOLS = ["vacuum", "control_home_assistant", "run_routine"] as const;

export const scheduleArgsClockTimeExample = {
  action: "set",
  when: { at: { hour: 4, minute: 30, meridiem: "pm", day: "today" } },
  label: "take the meat out of the fridge",
};

// A year out is the furthest anything is scheduled; it also keeps the due time
// inside the range a Date can hold.
const MAX_DELAY_MINUTES = 366 * 24 * 60;

// What the model is shown: one flat object, which reads more plainly than a
// union per action. scheduleRequestSchema holds what each action needs.
export const scheduleArgsSchema = z.object({
  action: z.enum(["set", "cancel", "list"]),
  when: z.object({
    in_minutes: z.coerce.number().optional()
      .describe("Only for 'in X minutes': minutes from now, e.g. 10, or 0.5 for thirty seconds."),
    at: z.object({
      hour: modelNumber.describe("The hour as said: 4 for 'at 4' or 'at 4 pm', 16 for 'at 16:00'."),
      minute: modelNumber.optional().describe("Minutes past the hour, e.g. 30 for 'half past'. Leave out for on the hour."),
      meridiem: z.enum(MERIDIEMS).describe("'am' or 'pm' only if it was said; otherwise 'unspecified'."),
      day: z.enum(CLOCK_DAYS).optional().describe("Only if it was said: 'today' or 'tomorrow'."),
    }).optional().describe("For a clock time: 'at 4 pm', 'at half past six', 'tomorrow at 7'."),
  }).optional().describe("For set: when it should happen. Either in_minutes or at, never both."),
  label: z.string().optional()
    .describe("For set: what it's for, e.g. 'the pasta' or 'take the meat out of the fridge'. Announced when it's time."),
  run: z.object({
    tool: z.enum(RUNNABLE_TOOLS),
    args: z.record(z.string(), z.unknown())
      .describe("The arguments, exactly as for calling that tool now, e.g. {action: 'start'} for vacuum."),
  }).optional()
    .describe("For set, only to do something at that time instead of just announcing the label: the tool call to make then. You say how it went afterwards."),
  job_id: z.string().optional()
    .describe("For cancel: the id from set or list, or part of the label. Leave out to cancel the only one."),
});

// A field the model means to leave out often arrives as null.
const absent = z.null().optional();

const clockTimeSchema = z.object({
  hour: modelNumber.pipe(z.number().int().min(0).max(23)),
  minute: modelNumber.pipe(z.number().int().min(0).max(59)).nullish(),
  meridiem: z.enum(MERIDIEMS),
  day: z.enum(CLOCK_DAYS).nullish(),
}).transform((at): ClockTime => ({
  hour: at.hour,
  minute: at.minute ?? 0,
  meridiem: at.meridiem,
  ...(at.day ? { day: at.day } : {}),
}));

export type ScheduleWhen =
  | { kind: "in"; minutes: number }
  | { kind: "at"; time: ClockTime };

// Exactly one of in_minutes or at.
const whenSchema = z.union([
  z.object({ in_minutes: z.coerce.number().positive().max(MAX_DELAY_MINUTES), at: absent })
    .transform((when): ScheduleWhen => ({ kind: "in", minutes: when.in_minutes })),
  z.object({ at: clockTimeSchema, in_minutes: absent })
    .transform((when): ScheduleWhen => ({ kind: "at", time: when.at })),
]);

// run isn't offered to the model yet: announce is the only schedulable tool
// until Phase 3. Without it, the job announces its label.
const setRequestSchema = z.object({
  action: z.literal("set"),
  when: whenSchema,
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
