// The calendar date (YYYY-MM-DD) of an instant in the given timezone.
export function localDate(at: number, timezone: string): string {
  return new Date(at).toLocaleDateString("sv-SE", { timeZone: timezone });
}
