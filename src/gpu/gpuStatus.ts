// Phase 2 of the GPU routing design (see project memory: gpu_routing_design.md,
// gpu_routing_implementation_plan.md) - an in-memory cache for the dev PC's
// pushed GPU status, isolated from Phase 3's actual routing logic so this
// piece is testable with fake curl payloads alone.
//
// Manual override (Phase 5, "I'm gaming" / "I'm free") lives here too, not on
// the PC - the PC's status-service.ps1 is deliberately kept "dumb": it only
// detects and reports its own GPU state, it doesn't decide how Sakke routes.
// Centralizing the decision here means there's exactly one place that owns
// "should Sakke route to the PC right now", instead of two independently
// computed override states (PC-side and gateway-side) that could drift.

export type GpuState = "available" | "busy" | "unknown";
export type GpuSource = "auto" | "manual" | null;

// If no heartbeat arrives within this window, treat the state as "unknown"
// and let callers fail closed to the server - matches the fail-closed
// preference already established elsewhere in this project (see [[feedback]]):
// prefer the recoverable outcome (falling back to the always-on server model)
// over trusting a status that might be stale because the PC is asleep,
// off, or unreachable.
const STALE_AFTER_MS = 45 * 1000;

const DEFAULT_OVERRIDE_TTL_MINUTES = 240;

interface GpuStatusPush {
  state: "available" | "busy";
}

interface GpuStatusResult {
  state: GpuState;
  source: GpuSource;
  overrideExpiresAt: string | null;
  lastSeen: string | null;
  staleMs: number | null;
}

interface ManualOverride {
  state: "busy" | "available";
  expiresAt: number;
}

let lastPush: GpuStatusPush | null = null;
let lastSeenAt: number | null = null;
let manualOverride: ManualOverride | null = null;

export function recordGpuStatus(push: GpuStatusPush): void {
  lastPush = push;
  lastSeenAt = Date.now();
}

// "Gaming" always wins immediately and unconditionally - forcing "busy" is
// the safe direction (it only ever stops routing early), so there's no need
// to reconcile it against whatever the PC's own detection currently reports.
export function setManualOverride(state: "busy" | "available", ttlMinutes: number = DEFAULT_OVERRIDE_TTL_MINUTES): void {
  manualOverride = { state, expiresAt: Date.now() + ttlMinutes * 60_000 };
}

// "Free" only clears the override and resumes trusting the PC's own
// detection - it deliberately does NOT force "available", so a stale "I'm
// free" from hours ago can never fight a real, live "busy" reading. That
// asymmetry is the same one the Phase 4 crash fix established: a false
// "available" is the dangerous direction, so nothing should be able to force it.
export function clearManualOverride(): void {
  manualOverride = null;
}

export function getGpuStatus(): GpuStatusResult {
  if (manualOverride) {
    if (Date.now() < manualOverride.expiresAt) {
      return {
        state: manualOverride.state,
        source: "manual",
        overrideExpiresAt: new Date(manualOverride.expiresAt).toISOString(),
        lastSeen: lastSeenAt !== null ? new Date(lastSeenAt).toISOString() : null,
        staleMs: lastSeenAt !== null ? Date.now() - lastSeenAt : null,
      };
    }
    manualOverride = null; // TTL expired - fall through to the PC's own reading
  }

  if (!lastPush || lastSeenAt === null) {
    return { state: "unknown", source: null, overrideExpiresAt: null, lastSeen: null, staleMs: null };
  }

  const staleMs = Date.now() - lastSeenAt;
  const lastSeen = new Date(lastSeenAt).toISOString();

  if (staleMs > STALE_AFTER_MS) {
    return { state: "unknown", source: "auto", overrideExpiresAt: null, lastSeen, staleMs };
  }

  return { state: lastPush.state, source: "auto", overrideExpiresAt: null, lastSeen, staleMs };
}
