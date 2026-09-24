import { promises as fs } from "fs";
import { join } from "path";
import { moduleLog } from "../logger.js";
import { config } from "../config.js";

// What happens when a timer finishes is injected, not imported. This module
// used to import runAgent directly, which closed a cycle - timers -> agent ->
// executor (the `timer` tool) -> timers - and meant importing the scheduler
// pulled in 19 modules including every Home Assistant and Spotify client.
// Phrasing an announcement was never the scheduler's job anyway: it knows
// WHEN, not what to say. index.ts wires the real handler at startup; see
// timerAnnouncer.ts.
export type TimerHandler = (label: string) => Promise<void>;

let onTimerFired: TimerHandler = async () => {};

export function setTimerHandler(handler: TimerHandler): void {
  onTimerFired = handler;
}

interface ActiveTimer {
  id: string;
  label: string;
  endsAt: Date;
  handle: NodeJS.Timeout;
}

const timers = new Map<string, ActiveTimer>();

// Timers lived only in this Map, so every `s build` silently threw away
// whatever was running - no announcement, no trace, and the person who set one
// just never hears it go off. Persisted to disk instead and re-armed at
// startup. Best-effort throughout: if the state directory isn't writable the
// timer still works for this process's lifetime, which is exactly the old
// behaviour.
function timersFile(): string {
  return join(config.stateDir, "timers.json");
}

interface PersistedTimer {
  id: string;
  label: string;
  endsAt: number;
}

// Serialised: two writes overlapping raced on the same temp filename - the
// first rename consumed the file the second was still writing to.
let persistQueue: Promise<void> = Promise.resolve();

function persist(): Promise<void> {
  persistQueue = persistQueue.then(writeSnapshot, writeSnapshot);
  return persistQueue;
}

async function writeSnapshot(): Promise<void> {
  const snapshot: PersistedTimer[] = [...timers.values()].map(t => ({
    id: t.id,
    label: t.label,
    endsAt: t.endsAt.getTime(),
  }));
  try {
    await fs.mkdir(config.stateDir, { recursive: true });
    const tmp = `${timersFile()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(snapshot), "utf-8");
    await fs.rename(tmp, timersFile());
  } catch (err: any) {
    moduleLog().warn({ err: err.message, file: timersFile() }, "Could not persist timers - they will not survive a restart");
  }
}

// Called once at startup. Timers that came due while the service was down are
// dropped with a log line rather than fired late: announcing a timer that
// expired twenty minutes ago is worse than not announcing it.
export async function restoreTimers(): Promise<void> {
  let saved: PersistedTimer[];
  try {
    saved = JSON.parse(await fs.readFile(timersFile(), "utf-8")) as PersistedTimer[];
  } catch {
    return; // no state file yet, or unreadable - nothing to restore
  }

  const now = Date.now();
  let restored = 0;
  let expired = 0;

  for (const saved_timer of saved) {
    const remaining = saved_timer.endsAt - now;
    if (remaining <= 0) {
      expired++;
      continue;
    }
    armTimer(saved_timer.id, saved_timer.label, new Date(saved_timer.endsAt), remaining);
    restored++;
  }

  if (restored || expired) {
    moduleLog().info({ restored, expired }, "Restored timers from disk");
    await persist();
  }
}

function armTimer(id: string, label: string, endsAt: Date, durationMs: number): void {
  const handle = setTimeout(() => {
    timers.delete(id);
    void persist();
    onTimerFired(label).catch(err => moduleLog().error({ label, err: err.message }, "Timer handler failed"));
  }, durationMs);
  timers.set(id, { id, label, endsAt, handle });
}

export function setTimer(durationMs: number, label: string): string {
  const id = Math.random().toString(36).slice(2, 7);
  armTimer(id, label, new Date(Date.now() + durationMs), durationMs);
  void persist();
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
  void persist();
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
