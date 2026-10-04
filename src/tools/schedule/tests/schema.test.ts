import { describe, expect, it } from "vitest";
import { parseOrThrow } from "../../../util/validation.js";
import {
  scheduleArgsClockTimeExample,
  scheduleArgsExample,
  scheduleArgsRunExample,
  scheduleArgsSchema,
  scheduleRequestSchema,
} from "../schema.js";

const parseRequest = (args: unknown) => parseOrThrow(scheduleRequestSchema, args, "schedule request");
const set = (when: unknown) => ({ action: "set", when, label: "the meat" });

describe("schedule schemas", () => {
  it("accept their examples", () => {
    for (const example of [scheduleArgsExample, scheduleArgsClockTimeExample, scheduleArgsRunExample]) {
      expect(() => parseOrThrow(scheduleArgsSchema, example, "schedule args example")).not.toThrow();
      expect(() => parseRequest(example)).not.toThrow();
    }
  });
});

describe("when", () => {
  it("reads a duration", () => {
    expect(parseRequest(set({ in_minutes: 10 }))).toMatchObject({ when: { kind: "in", minutes: 10 } });
  });

  it("reads a clock time, with minutes on the hour unless said", () => {
    expect(parseRequest(set({ at: { hour: "4", meridiem: "pm" } }))).toMatchObject({
      when: { kind: "at", time: { hour: 4, minute: 0, meridiem: "pm" } },
    });
  });

  it("treats a null the model sent for a field it left out as absent", () => {
    const request = parseRequest(set({ in_minutes: null, at: { hour: 7, minute: null, meridiem: "unspecified", day: null } }));
    expect(request).toMatchObject({ when: { kind: "at", time: { hour: 7, minute: 0, meridiem: "unspecified" } } });
  });

  it.each([
    ["both a duration and a clock time", { in_minutes: 10, at: { hour: 4, meridiem: "pm" } }],
    ["neither", {}],
    ["an hour past 23", { at: { hour: 24, meridiem: "unspecified" } }],
    ["minutes past 59", { at: { hour: 4, minute: 60, meridiem: "pm" } }],
    ["a fractional hour", { at: { hour: 4.5, meridiem: "pm" } }],
    ["an unknown meridiem", { at: { hour: 4, meridiem: "evening" } }],
  ])("refuses %s", (_what, when) => {
    expect(() => parseRequest(set(when))).toThrow();
  });
});
