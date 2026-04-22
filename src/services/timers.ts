import { runAgent } from "./agent.js";

const haBase = process.env.HA_BASE_URL ?? "http://localhost:8123";
const haToken = process.env.HA_TOKEN ?? "";
const satelliteEntityId = process.env.ASSIST_SATELLITE_ENTITY_ID ?? "assist_satellite.home_assistant_voice";

interface ActiveTimer {
  id: string;
  label: string;
  endsAt: Date;
  handle: NodeJS.Timeout;
}

const timers = new Map<string, ActiveTimer>();

const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLog,
} as any;

async function fireTimer(label: string): Promise<void> {
  const { content } = await runAgent(
    `A timer has finished. It was set for: ${label}. Announce it.`,
    `timer-${Date.now()}`,
    silentLog,
  );
  await fetch(`${haBase}/api/services/assist_satellite/announce`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${haToken}`,
    },
    body: JSON.stringify({ entity_id: satelliteEntityId, message: content }),
  });
}

export function setTimer(durationMs: number, label: string): string {
  const id = Math.random().toString(36).slice(2, 7);
  const endsAt = new Date(Date.now() + durationMs);

  const handle = setTimeout(() => {
    timers.delete(id);
    fireTimer(label).catch(() => {});
  }, durationMs);

  timers.set(id, { id, label, endsAt, handle });
  return id;
}

export function cancelTimer(idOrLabel: string): string | null {
  let match = timers.get(idOrLabel);
  if (!match) {
    const lower = idOrLabel.toLowerCase();
    match = [...timers.values()].find((t) => t.label.toLowerCase().includes(lower));
  }
  if (!match) return null;
  clearTimeout(match.handle);
  timers.delete(match.id);
  return match.label;
}

export function listTimers(): { id: string; label: string; remainingMs: number }[] {
  const now = Date.now();
  return [...timers.values()].map((t) => ({
    id: t.id,
    label: t.label,
    remainingMs: t.endsAt.getTime() - now,
  }));
}
