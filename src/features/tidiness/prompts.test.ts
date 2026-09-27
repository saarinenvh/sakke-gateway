import { describe, it, expect } from "vitest";
import { buildNagRequest } from "./prompts.js";

describe("buildNagRequest", () => {
  it("gives the model the facts, the tone and the vacuum's name", () => {
    const request = buildNagRequest({ daysSinceClean: 9, declines: 1, tone: 3, vacuumName: "James" });
    expect(request).toContain("9 days ago");
    expect(request).toContain("said no once");
    expect(request).toContain("Sarcastic");
    expect(request).toContain("calls the vacuum James");
  });

  it("leaves the name out when there isn't one", () => {
    const request = buildNagRequest({ daysSinceClean: 7, declines: 0, tone: 1, vacuumName: undefined });
    expect(request).not.toContain("calls the vacuum");
    expect(request).not.toContain("  ");
  });
});
