import { config } from "../config.js";

// TZ, not config.timezone: the compose file, .env and .env.example all set TZ, and
// nothing ever set config.timezone - this only ever worked because the hardcoded
// fallback happened to be right.

interface CalendarEvent {
  summary: string;
  start: { date?: string; dateTime?: string };
}

interface TodoItem {
  uid?: string;
  summary: string;
  status: "needs_action" | "completed";
  due?: string;
}

async function haGet(path: string): Promise<any> {
  const res = await fetch(`${config.ha.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${config.ha.token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HA ${res.status}: ${await res.text()}`);
  return res.json();
}

async function haPost(path: string, body: object): Promise<any> {
  const res = await fetch(`${config.ha.baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.ha.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HA ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getTodayEvents(calendarEntityId: string, start?: Date, end?: Date): Promise<CalendarEvent[]> {
  const now = new Date();
  const s = start ?? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const e = end ?? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const events = await haGet(
    `/api/calendars/${calendarEntityId}?start=${s.toISOString()}&end=${e.toISOString()}`
  );
  return events as CalendarEvent[];
}

function getDateRange(period: string): { start: string; end: string } {
  const now = new Date();
  const todayStr = now.toLocaleDateString("sv-SE", { timeZone: config.timezone });

  if (period === "tomorrow") {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString("sv-SE", { timeZone: config.timezone });
    return { start: tomorrowStr, end: tomorrowStr };
  }

  if (period === "this_week") {
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      start: monday.toLocaleDateString("sv-SE", { timeZone: config.timezone }),
      end: sunday.toLocaleDateString("sv-SE", { timeZone: config.timezone }),
    };
  }

  if (period === "next_week") {
    const day = now.getDay();
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + (day === 0 ? 1 : 8 - day));
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    return {
      start: nextMonday.toLocaleDateString("sv-SE", { timeZone: config.timezone }),
      end: nextSunday.toLocaleDateString("sv-SE", { timeZone: config.timezone }),
    };
  }

  return { start: todayStr, end: todayStr };
}

async function getPendingTasks(period = "today"): Promise<TodoItem[]> {
  const data = await haPost("/api/services/todo/get_items?return_response=true", {
    entity_id: config.ha.tasksTodo,
  });
  const root = data?.service_response ?? data;
  const items = (root[config.ha.tasksTodo]?.items ?? []) as TodoItem[];
  const { start, end } = getDateRange(period);
  // Compare the date portion only. start/end are date-only ("2026-09-24"), but
  // a due value carrying a time ("2026-09-24T10:00:00") is a longer string that
  // sorts AFTER the plain date, so `due <= end` was false for anything due at a
  // specific time today - silently dropped from the briefing rather than
  // reported late.
  return items.filter(i =>
    i.status !== "completed" && (!i.due || (i.due.slice(0, 10) >= start && i.due.slice(0, 10) <= end))
  );
}

function formatEventTime(event: CalendarEvent): string {
  const dt = event.start.dateTime;
  if (!dt) return event.summary;
  const time = new Date(dt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: config.timezone });
  return `${event.summary} at ${time}`;
}

export async function getTasksText(period = "today"): Promise<string> {
  const tasks = await getPendingTasks(period);
  if (tasks.length === 0) return `No tasks for ${period}.`;
  return `Tasks (${period}): ` + tasks.map(t => t.summary).join(", ") + ".";
}

export async function getCalendarText(period = "today"): Promise<string> {
  const { start, end } = getDateRange(period);
  const startDt = new Date(`${start}T00:00:00`);
  const endDt = new Date(`${end}T23:59:59`);
  const parts: string[] = [];
  for (const calendarId of config.ha.calendarEntities) {
    const events = await getTodayEvents(calendarId, startDt, endDt);
    if (events.length > 0) {
      parts.push(...events.map(formatEventTime));
    }
  }
  if (parts.length === 0) return `Nothing on the calendar for ${period}.`;
  return `Events (${period}): ` + parts.join(", ") + ".";
}

export async function getMorningGreeting(): Promise<string> {
  const parts: string[] = [];

  const tasks = await getPendingTasks();
  if (tasks.length > 0) {
    const taskList = tasks.map(t => t.summary).join(", ");
    parts.push(`Tasks for today: ${taskList}`);
  }

  for (const calendarId of config.ha.calendarEntities) {
    const events = await getTodayEvents(calendarId);
    if (events.length > 0) {
      const eventList = events.map(formatEventTime).join(", ");
      parts.push(`Calendar: ${eventList}`);
    }
  }

  if (parts.length === 0) {
    return "Good morning! Nothing on the schedule today.";
  }

  return `Good morning! ${parts.join(". ")}.`;
}

export async function getPendingReminder(): Promise<string | null> {
  const tasks = await getPendingTasks();
  if (tasks.length === 0) return null;

  const list = tasks.map(t => t.summary).join(", ");
  return `Still pending: ${list}.`;
}
