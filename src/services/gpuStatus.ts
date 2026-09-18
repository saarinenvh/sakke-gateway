// Phase 2 of the GPU routing design (see project memory: gpu_routing_design.md,
// gpu_routing_implementation_plan.md) - an in-memory cache for the dev PC's
// pushed GPU status, isolated from Phase 3's actual routing logic so this
// piece is testable with fake curl payloads alone.

export type GpuState = "available" | "busy" | "unknown";
export type GpuSource = "auto" | "manual" | null;

// If no heartbeat arrives within this window, treat the state as "unknown"
// and let callers fail closed to the server - matches the fail-closed
// preference already established elsewhere in this project (see [[feedback]]):
// prefer the recoverable outcome (falling back to the always-on server model)
// over trusting a status that might be stale because the PC is asleep,
// off, or unreachable.
const STALE_AFTER_MS = 45 * 1000;

interface GpuStatusPush {
  state: "available" | "busy";
  source: "auto" | "manual";
  overrideExpiresAt: string | null;
}

interface GpuStatusResult {
  state: GpuState;
  source: GpuSource;
  overrideExpiresAt: string | null;
  lastSeen: string | null;
  staleMs: number | null;
}

let lastPush: GpuStatusPush | null = null;
let lastSeenAt: number | null = null;

export function recordGpuStatus(push: GpuStatusPush): void {
  lastPush = push;
  lastSeenAt = Date.now();
}

export function getGpuStatus(): GpuStatusResult {
  if (!lastPush || lastSeenAt === null) {
    return { state: "unknown", source: null, overrideExpiresAt: null, lastSeen: null, staleMs: null };
  }

  const staleMs = Date.now() - lastSeenAt;
  const lastSeen = new Date(lastSeenAt).toISOString();

  if (staleMs > STALE_AFTER_MS) {
    return { state: "unknown", source: lastPush.source, overrideExpiresAt: lastPush.overrideExpiresAt, lastSeen, staleMs };
  }

  return { state: lastPush.state, source: lastPush.source, overrideExpiresAt: lastPush.overrideExpiresAt, lastSeen, staleMs };
}
