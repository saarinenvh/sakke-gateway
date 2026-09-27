import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The module keeps its cache and override in module state with no reset hook,
// so each test gets a fresh copy rather than a test-only export being added to
// production code.
async function freshModule() {
  vi.resetModules();
  return import("./gpuStatus.js");
}

let gpu: Awaited<ReturnType<typeof freshModule>>;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
  gpu = await freshModule();
});

afterEach(() => vi.useRealTimers());

describe("with no push from the PC", () => {
  it("is unknown, so callers fail closed to the server", () => {
    const status = gpu.getGpuStatus();
    expect(status.state).toBe("unknown");
    expect(status.source).toBeNull();
    expect(status.lastSeen).toBeNull();
  });
});

describe("auto-detected state", () => {
  it("reports what the PC last pushed", () => {
    gpu.recordGpuStatus({ state: "available" });
    expect(gpu.getGpuStatus()).toMatchObject({ state: "available", source: "auto" });

    gpu.recordGpuStatus({ state: "busy" });
    expect(gpu.getGpuStatus()).toMatchObject({ state: "busy", source: "auto" });
  });

  it("goes unknown once the heartbeat is stale, rather than trusting an old reading", () => {
    gpu.recordGpuStatus({ state: "available" });
    vi.advanceTimersByTime(44_000);
    expect(gpu.getGpuStatus().state).toBe("available");

    vi.advanceTimersByTime(2_000); // past the 45s window
    const stale = gpu.getGpuStatus();
    expect(stale.state).toBe("unknown");
    // The last known source and timestamp survive, for debugging.
    expect(stale.source).toBe("auto");
    expect(stale.lastSeen).not.toBeNull();
  });
});

// The asymmetry here is deliberate and is the whole safety property: a false
// "busy" costs one missed routing cycle, a false "available" sends inference to
// a PC that is mid-game. It crashed the PC once. Nothing but a comment held it
// in place before these tests.
describe("manual override", () => {
  it("'gaming' forces busy even while the PC is reporting available", () => {
    gpu.recordGpuStatus({ state: "available" });
    gpu.setManualOverride("busy");
    expect(gpu.getGpuStatus()).toMatchObject({ state: "busy", source: "manual" });
  });

  it("survives a contradicting auto push arriving afterwards", () => {
    gpu.setManualOverride("busy");
    gpu.recordGpuStatus({ state: "available" }); // the PC's next heartbeat
    expect(gpu.getGpuStatus().state).toBe("busy");
  });

  it("'free' clears the override and never forces available", () => {
    // clearManualOverride is what "I'm free" calls. If it instead forced
    // "available", a stale "I'm free" from hours ago could beat a live busy
    // reading - which is the dangerous direction.
    gpu.recordGpuStatus({ state: "busy" });
    gpu.setManualOverride("busy");
    gpu.clearManualOverride();

    const status = gpu.getGpuStatus();
    expect(status.state).toBe("busy");   // the PC's own reading, not "available"
    expect(status.source).toBe("auto");
  });

  it("falls back to the PC's reading when the override expires", () => {
    gpu.recordGpuStatus({ state: "available" });
    gpu.setManualOverride("busy", 60);
    expect(gpu.getGpuStatus().state).toBe("busy");

    // Still overridden late in the TTL, even though the original push has long
    // since gone stale - an active override doesn't depend on the heartbeat.
    vi.advanceTimersByTime(59 * 60_000);
    expect(gpu.getGpuStatus().state).toBe("busy");

    // Past the TTL. The PC heartbeats every ~20s, so by now there is a current
    // reading to fall back to.
    vi.advanceTimersByTime(2 * 60_000);
    gpu.recordGpuStatus({ state: "available" });
    expect(gpu.getGpuStatus()).toMatchObject({ state: "available", source: "auto" });
  });

  it("falls back to unknown, not available, if the override expires and the PC has gone quiet", () => {
    gpu.recordGpuStatus({ state: "available" });
    gpu.setManualOverride("busy", 1);
    vi.advanceTimersByTime(2 * 60_000); // TTL gone, and no heartbeat since
    expect(gpu.getGpuStatus().state).toBe("unknown");
  });

  it("reports when the override expires while it is active", () => {
    gpu.setManualOverride("busy", 240);
    const status = gpu.getGpuStatus();
    expect(status.overrideExpiresAt).toBe(new Date(Date.UTC(2026, 8, 25, 16, 0, 0)).toISOString());
  });

  it("an expired override with no push behind it is unknown, not available", () => {
    gpu.setManualOverride("busy", 1);
    vi.advanceTimersByTime(2 * 60_000);
    expect(gpu.getGpuStatus().state).toBe("unknown");
  });
});
