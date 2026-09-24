import { runAgent } from "../agent/agent.js";
import { config } from "../config.js";
import { moduleLog } from "../logger.js";

// The "what to say when a timer finishes" half of the timer feature, kept out
// of timers.ts so the scheduler doesn't have to know about the agent - see the
// note there about the import cycle that created.

// runAgent wants a logger; a timer firing shouldn't add a full agent trace to
// the request log.
const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLog,
} as any;

export async function announceFinishedTimer(label: string): Promise<void> {
  // A throwaway conversation id: the announcement is its own exchange and has
  // no business appearing in whatever the user was last talking about.
  const { content } = await runAgent(
    `A timer has finished. It was set for: ${label}. Announce it.`,
    `timer-${Date.now()}`,
    silentLog,
  );

  const res = await fetch(`${config.ha.baseUrl}/api/services/assist_satellite/announce`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.ha.token}`,
    },
    body: JSON.stringify({ entity_id: config.ha.satelliteEntityId, message: content }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`HA announce ${res.status}: ${await res.text()}`);
  moduleLog().info({ label }, "Timer announced");
}
