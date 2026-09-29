import { z } from "zod";

export const sakkeStateSchema = z.enum(["idle", "listening", "thinking", "speaking"]);

export type SakkeState = z.output<typeof sakkeStateSchema>;

let currentState: SakkeState = "idle";
const clients = new Set<(data: string) => void>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

export function registerSSEClient(send: (data: string) => void): () => void {
  clients.add(send);
  try { send(`data: ${JSON.stringify({ state: currentState })}\n\n`); } catch {}
  return () => clients.delete(send);
}

export function broadcastState(state: SakkeState, autoIdleAfterMs?: number): void {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  currentState = state;
  const msg = `data: ${JSON.stringify({ state })}\n\n`;
  for (const send of clients) {
    try { send(msg); } catch { clients.delete(send); }
  }
  if (autoIdleAfterMs) {
    idleTimer = setTimeout(() => broadcastState("idle"), autoIdleAfterMs);
  }
}

const MIN_SPEAKING_MS = 2000;
const SPEAKING_MS_PER_CHARACTER = 70;

// How long saying this takes, roughly, for the display's speaking animation.
export function speakingDurationMs(text: string): number {
  return Math.max(MIN_SPEAKING_MS, text.length * SPEAKING_MS_PER_CHARACTER);
}

// Shows Sakke speaking while `speak` makes the satellite say `text`, and goes
// back to idle if that fails, so the display follows what was actually said.
export async function showSpeakingWhile<T>(text: string, speak: () => Promise<T>): Promise<T> {
  broadcastState("speaking", speakingDurationMs(text));
  try {
    return await speak();
  } catch (err) {
    broadcastState("idle");
    throw err;
  }
}

export function getCurrentState(): SakkeState {
  return currentState;
}
