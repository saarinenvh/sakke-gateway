const baseUrl = process.env.HA_BASE_URL ?? "http://localhost:8123";
const token = process.env.HA_TOKEN ?? "";

const TASKS_TODO_ENTITY = process.env.TASKS_TODO ?? "todo.sakke_tasks";
const CALENDAR_ENTITIES: string[] = (process.env.CALENDAR_ENTITIES ?? "").split(",").filter(Boolean);

interface CalendarEvent {
  summary: string;
  start: { date?: string; dateTime?: string };
}

interface TodoItem {
  uid?: string;
  summary: string;
  status: "needs_action" | "completed";
}

async function haGet(path: string): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HA ${res.status}: ${await res.text()}`);
  return res.json();
}

async function haPost(path: string, body: object): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HA ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getTodayEvents(calendarEntityId: string): Promise<CalendarEvent[]> {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const events = await haGet(
    `/api/calendars/${calendarEntityId}?start=${start.toISOString()}&end=${end.toISOString()}`
  );
  return events as CalendarEvent[];
}

async function getPendingTasks(): Promise<TodoItem[]> {
  const data = await haPost("/api/services/todo/get_items?return_response=true", {
    entity_id: TASKS_TODO_ENTITY,
    status: "needs_action",
  });
  return (data[TASKS_TODO_ENTITY]?.items ?? []) as TodoItem[];
}

function formatEventTime(event: CalendarEvent): string {
  const dt = event.start.dateTime;
  if (!dt) return event.summary; // all-day event, no time
  const time = new Date(dt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${event.summary} at ${time}`;
}

export async function getTasksText(): Promise<string> {
  const tasks = await getPendingTasks();
  if (tasks.length === 0) return "No pending tasks.";
  return "Pending tasks: " + tasks.map(t => t.summary).join(", ") + ".";
}

export async function getCalendarText(): Promise<string> {
  const parts: string[] = [];
  for (const calendarId of CALENDAR_ENTITIES) {
    const events = await getTodayEvents(calendarId);
    if (events.length > 0) {
      parts.push(...events.map(formatEventTime));
    }
  }
  if (parts.length === 0) return "Nothing on the calendar today.";
  return "Today's events: " + parts.join(", ") + ".";
}

export async function getMorningGreeting(): Promise<string> {
  const parts: string[] = [];

  // Pending tasks
  const tasks = await getPendingTasks();
  if (tasks.length > 0) {
    const taskList = tasks.map(t => t.summary).join(", ");
    parts.push(`Tasks for today: ${taskList}`);
  }

  // Calendar events
  for (const calendarId of CALENDAR_ENTITIES) {
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
