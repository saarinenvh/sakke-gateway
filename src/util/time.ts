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

// The local clock time of an instant, "HH:MM".
export function localTimeOfDay(at: Date, timezone: string): string {
  return at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone });
}

// A calendar date (YYYY-MM-DD) moved by whole days.
export function addDays(localDateString: string, days: number): string {
  const [year, month, day] = localDateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

// The instant a local date and clock time name in the timezone. Around a
// daylight saving change: a time that doesn't exist (skipped when clocks go
// forward) moves forward by the gap, so 03:30 becomes 04:30, and a time that
// happens twice (when clocks go back) is its first occurrence.
export function localWallTimeToInstant(localDateString: string, hour: number, minute: number, timezone: string): Date {
  const [year, month, day] = localDateString.split("-").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);

  // A timezone changes its offset at most once within a day either side.
  const offsetBefore = utcOffsetMs(wallAsUtc - HALF_DAY_MS, timezone);
  const offsetAfter = utcOffsetMs(wallAsUtc + HALF_DAY_MS, timezone);
  const matching = [wallAsUtc - offsetBefore, wallAsUtc - offsetAfter]
    .filter(instant => utcOffsetMs(instant, timezone) === wallAsUtc - instant);

  if (matching.length === 0) return new Date(wallAsUtc - offsetBefore);
  return new Date(Math.min(...matching));
}

// How far the timezone's clock is ahead of UTC at an instant.
function utcOffsetMs(at: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find(p => p.type === type)?.value);
  const wallAsUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return wallAsUtc - Math.floor(at / 1000) * 1000;
}
