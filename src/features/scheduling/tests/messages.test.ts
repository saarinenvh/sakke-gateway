import { describe, expect, it } from "vitest";
import { outcomeMessage } from "../messages.js";

const HELSINKI = "Europe/Helsinki";
// 11:00 in Helsinki.
const ELEVEN = new Date("2026-10-04T08:00:00.000Z");
const job = { label: "start the vacuum", runAt: ELEVEN };

describe("outcomeMessage", () => {
  it("says the action was done, with what the tool reported", () => {
    expect(outcomeMessage(job, { status: "done", result: "The vacuum is starting." }, ELEVEN, HELSINKI))
      .toBe("It's 11:00: done as scheduled, start the vacuum. The vacuum is starting.");
  });

  it("says the action didn't work, with why", () => {
    expect(outcomeMessage(job, { status: "failed", result: "There is no robot vacuum in Home Assistant." }, ELEVEN, HELSINKI))
      .toBe("It's 11:00: the scheduled \"start the vacuum\" didn't work. There is no robot vacuum in Home Assistant.");
  });

  it("says when it was due if it ran late", () => {
    const tenPast = new Date(ELEVEN.getTime() + 10 * 60_000);
    expect(outcomeMessage(job, { status: "done", result: "The vacuum is starting." }, tenPast, HELSINKI))
      .toBe("It's 11:10: done as scheduled, start the vacuum. The vacuum is starting. (This was due at 11:00.)");
  });
});
