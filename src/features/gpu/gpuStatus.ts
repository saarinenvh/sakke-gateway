// The dev PC's pushed status. The PC only reports what it observes; the
// routing decision, including the manual override, is made here.

export type GpuState = "available" | "busy" | "unknown";
export type GpuSource = "auto" | "manual" | null;

// Without a heartbeat in this window the state is "unknown", and callers fail
// closed to the server.
const STALE_AFTER_MS = 45 * 1000;

const DEFAULT_OVERRIDE_TTL_MINUTES = 240;

export interface GpuStatusPush {
  state: "available" | "busy";
  idleSeconds?: number;
}

interface GpuStatusResult {
  state: GpuState;
  source: GpuSource;
  overrideExpiresAt: string | null;
  lastSeen: string | null;
  staleMs: number | null;
  lastInputAt: string | null;
}

interface ManualOverride {
  state: "busy" | "available";
  expiresAt: number;
}

let lastPush: GpuStatusPush | null = null;
let lastSeenAt: number | null = null;
let manualOverride: ManualOverride | null = null;
let lastInputAt: number | null = null;

export function recordGpuStatus(push: GpuStatusPush): void {
  lastPush = push;
  lastSeenAt = Date.now();
  if (push.idleSeconds !== undefined) {
    lastInputAt = lastSeenAt - push.idleSeconds * 1000;
  }
}

// Forcing "busy" is the safe direction, so it wins over the PC's own reading.
export function setManualOverride(state: "busy" | "available", ttlMinutes: number = DEFAULT_OVERRIDE_TTL_MINUTES): void {
  manualOverride = { state, expiresAt: Date.now() + ttlMinutes * 60_000 };
}

// Clears the override without forcing "available": a false "available" is the
// dangerous direction, so only the PC's live reading may report it.
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
        lastInputAt: formatLastInputAt(),
      };
    }
    manualOverride = null; // TTL expired - fall through to the PC's own reading
  }

  if (!lastPush || lastSeenAt === null) {
    return { state: "unknown", source: null, overrideExpiresAt: null, lastSeen: null, staleMs: null, lastInputAt: null };
  }

  const staleMs = Date.now() - lastSeenAt;
  const lastSeen = new Date(lastSeenAt).toISOString();

  if (staleMs > STALE_AFTER_MS) {
    return { state: "unknown", source: "auto", overrideExpiresAt: null, lastSeen, staleMs, lastInputAt: formatLastInputAt() };
  }

  return { state: lastPush.state, source: "auto", overrideExpiresAt: null, lastSeen, staleMs, lastInputAt: formatLastInputAt() };
}

function formatLastInputAt(): string | null {
  return lastInputAt !== null ? new Date(lastInputAt).toISOString() : null;
}
