import type { FastifyBaseLogger } from "fastify";

// Modules that aren't handed a request logger used to fall back to console.log
// (scenes.ts and spotify.ts, which between them were the noisiest output in
// `s logs`) - bypassing pino entirely, so no level filtering, no structured
// fields, and formatting that didn't match anything else. index.ts injects
// Fastify's own logger here at startup so there's still exactly one pino
// instance rather than a second one with its own transport.
let injected: FastifyBaseLogger | null = null;

export function setModuleLogger(logger: FastifyBaseLogger): void {
  injected = logger;
}

// Before startup finishes (module-level code, tests) there's nothing injected
// yet - console keeps that from throwing, and its (obj, msg) call shape prints
// acceptably.
export function moduleLog(): FastifyBaseLogger {
  return injected ?? (console as unknown as FastifyBaseLogger);
}
