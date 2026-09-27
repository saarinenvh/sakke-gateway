export type SakkeState = "idle" | "listening" | "thinking" | "speaking";

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

export function getCurrentState(): SakkeState {
  return currentState;
}
