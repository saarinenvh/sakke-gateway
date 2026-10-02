// The calendar date (YYYY-MM-DD) of an instant in the given timezone.
export function localDate(at: number, timezone: string): string {
  return new Date(at).toLocaleDateString("sv-SE", { timeZone: timezone });
}

// Minutes since local midnight, 0-1439.
export function localMinuteOfDay(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find(p => p.type === "hour")?.value);
  const minute = Number(parts.find(p => p.type === "minute")?.value);
  return hour * 60 + minute;
}
