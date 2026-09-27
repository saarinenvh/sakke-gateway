import { z } from "zod";

// Data from outside this service - an HTTP response, a persisted file, a
// request body - didn't have the shape it was parsed against. Kept apart from
// transport errors (HaError, OpenAiError, ...) because there is no status to
// report: the other side answered, just not in a way this code understands.
export class ValidationError extends Error {
  constructor(
    readonly source: string,
    readonly issues: string,
  ) {
    super(`${source} failed validation: ${issues}`);
    this.name = "ValidationError";
  }
}

// `source` names where the value came from ("HA GET /api/states"), so the
// error is debuggable from the log line alone.
export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown, source: string): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(source, z.prettifyError(parsed.error));
  return parsed.data;
}
