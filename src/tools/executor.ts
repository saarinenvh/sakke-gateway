import { promises as fs } from "fs";
import type { FastifyBaseLogger } from "fastify";
import { dispatch } from "../services/ha/dispatcher.js";
import { webSearch } from "../services/integrations/webSearch.js";
import { getWeather } from "../services/integrations/weather.js";
import { readList, addToList, completeInList, removeFromList, sortList } from "../services/ha/lists.js";
import { spotifyPlay, spotifyPause, spotifyNext, spotifyPrevious, spotifyVolume, spotifySuggest, spotifyPlayIndexed, spotifyPlayPersonal } from "../services/integrations/spotify.js";
import { getTasksText, getCalendarText } from "../services/ha/reminders.js";
import { setTimer, cancelTimer, listTimers } from "../services/timers.js";
import { loadEntities, getAreas, getScenes, getScripts } from "../services/ha/registry.js";
import { setManualOverride, clearManualOverride } from "../services/gpuStatus.js";
import type { Intent } from "../types/intent.js";

const haBase = process.env.HA_BASE_URL ?? "http://localhost:8123";
const haToken = process.env.HA_TOKEN ?? "";
const haHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${haToken}` };

// Prefer deep links over bare package names - HA's androidtv_remote docs warn that
// launching by application ID "doesn't work for many apps due to a Google Play Store
// change." No verified deep link is known for dgn, so it's left as a package name and
// may still fail to launch - test and swap in a working deep link if found.
const APP_PACKAGES: Record<string, string> = {
  netflix: "https://www.netflix.com/title",
  youtube: "https://www.youtube.com",
  spotify: "spotify://",
  dgn: "com.discgolfprotour",
};

const REMOTE_COMMANDS: Record<string, string> = {
  home: "HOME",
  back: "BACK",
  mute: "MUTE",
  search: "SEARCH",
};

// Same trick status-service.ps1 used on the PC side before it was simplified
// to pure telemetry: Ollama has no direct "unload" call, but keep_alive: 0
// with no prompt evicts a loaded model immediately. Queried per-model from
// /api/ps rather than assuming a name, same as before.
async function unloadPcOllamaModels(pcOllamaUrl: string, log: FastifyBaseLogger): Promise<void> {
  const timeout = AbortSignal.timeout(5000);
  const psRes = await fetch(`${pcOllamaUrl}/api/ps`, { signal: timeout });
  if (!psRes.ok) throw new Error(`PC Ollama /api/ps ${psRes.status}`);
  const { models } = (await psRes.json()) as { models?: { name: string }[] };
  for (const m of models ?? []) {
    log.info({ tool: "set_gaming_mode", model: m.name }, "Unloading PC Ollama model");
    await fetch(`${pcOllamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: m.name, keep_alive: 0 }),
      signal: AbortSignal.timeout(5000),
    });
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  log: FastifyBaseLogger,
  conversationId: string,
): Promise<string> {
  if (name === "control_home_assistant") {
    log.info({ conversationId, tool: "control_home_assistant", args }, "Tool call: HA");
    try {
      const intent = { ...args, raw: JSON.stringify(args) } as Intent;
      const result = await dispatch(intent);
      log.info({ conversationId, tool: "control_home_assistant", result }, "HA tool result");
      return result;
    } catch (err: any) {
      log.error({ conversationId, tool: "control_home_assistant", err: err.message }, "HA tool error");
      return `Error: ${err.message}`;
    }
  }

  if (name === "get_weather") {
    log.info({ conversationId, tool: "get_weather" }, "Tool call: weather");
    try {
      const result = await getWeather();
      log.info({ conversationId, tool: "get_weather", result }, "Weather result");
      return result;
    } catch (err: any) {
      log.error({ conversationId, tool: "get_weather", err: err.message }, "Weather error");
      return `Weather fetch failed: ${err.message}`;
    }
  }

  if (name === "spotify") {
    const { action, query, type, volume, offset, index } = args as { action: string; query?: string; type?: "track" | "artist" | "playlist" | "album"; volume?: number; offset?: number; index?: number };
    log.info({ conversationId, tool: "spotify", action, query, type, offset, index }, "Tool call: Spotify");
    try {
      let result: string;
      if (action === "suggest" && query) {
        // A known personal playlist should play instantly regardless of which
        // action the model picked - the model is told to always call "suggest"
        // first for named requests, so the personal-playlist shortcut can't
        // depend on it choosing "play" instead.
        result = (await spotifyPlayPersonal(query)) ?? await spotifySuggest(conversationId, query, type ?? "track", offset ?? 0);
      }
      else if (action === "suggest") result = await spotifySuggest(conversationId, query ?? "", type ?? "track", offset ?? 0);
      else if (index && action === "play") result = await spotifyPlayIndexed(conversationId, index);
      else if (action === "play" && query) {
        // No direct search-and-blind-play anymore - STT makes exact-name matches
        // too unreliable. A known personal playlist plays instantly (unambiguous);
        // anything else falls back to search results instead of guessing.
        result = (await spotifyPlayPersonal(query)) ?? await spotifySuggest(conversationId, query, type ?? "track", 0);
      }
      else if (action === "play") result = await spotifyPlay();
      else if (action === "pause" || action === "stop" || action === "media_stop") result = await spotifyPause();
      else if (action === "next") result = await spotifyNext();
      else if (action === "previous") result = await spotifyPrevious();
      else if (action === "volume") result = await spotifyVolume(volume ?? 50);
      else result = `Unknown spotify action: ${action}. Valid actions: play, pause, next, previous, volume, suggest.`;
      log.info({ conversationId, tool: "spotify", result }, "Spotify result");
      return result;
    } catch (err: any) {
      log.error({ conversationId, tool: "spotify", err: err.message }, "Spotify error");
      return `Spotify failed: ${err.message}`;
    }
  }

  if (name === "manage_list") {
    const { action, list, items, item } = args as { action: string; list: string; items?: string[]; item?: string };
    log.info({ conversationId, tool: "manage_list", action, list }, "Tool call: list");
    try {
      let result: string;
      if (action === "list_read") result = await readList(list);
      else if (action === "list_add") {
        const raw = items?.length ? items : item ? [item] : [];
        const toAdd = raw.flatMap(s => s.split(/,\s*|\s+and\s+/i).map(t => t.trim()).filter(Boolean));
        result = await addToList(list, toAdd);
      }
      else if (action === "list_complete") result = await completeInList(list, item ?? "");
      else if (action === "list_remove") result = await removeFromList(list, item ?? "");
      else if (action === "list_sort") result = await sortList(list);
      else result = `Unknown list action: ${action}`;
      log.info({ conversationId, tool: "manage_list", result }, "List result");
      return result;
    } catch (err: any) {
      log.error({ conversationId, tool: "manage_list", err: err.message }, "List error");
      return `List operation failed: ${err.message}`;
    }
  }

  if (name === "get_tasks") {
    const period = (args.period as string) ?? "today";
    log.info({ conversationId, tool: "get_tasks", period }, "Tool call: tasks");
    try {
      return await getTasksText(period);
    } catch (err: any) {
      log.error({ conversationId, tool: "get_tasks", err: err.message }, "Tasks error");
      return `Tasks fetch failed: ${err.message}`;
    }
  }

  if (name === "get_calendar") {
    const period = (args.period as string) ?? "today";
    log.info({ conversationId, tool: "get_calendar", period }, "Tool call: calendar");
    try {
      return await getCalendarText(period);
    } catch (err: any) {
      log.error({ conversationId, tool: "get_calendar", err: err.message }, "Calendar error");
      return `Calendar fetch failed: ${err.message}`;
    }
  }

  if (name === "open_tv_app") {
    const app = args.app as string;
    const pkg = APP_PACKAGES[app];
    if (!pkg) return `Unknown app: ${app}`;
    log.info({ conversationId, tool: "open_tv_app", app, pkg }, "Tool call: open TV app");
    try {
      const stateRes = await fetch(`${haBase}/api/states/remote.living_room_tv`, {
        headers: { Authorization: `Bearer ${haToken}` },
      });
      if (!stateRes.ok) throw new Error(`HA API ${stateRes.status}`);
      const state = await stateRes.json() as { state: string };

      if (state.state !== "on") {
        await fetch(`${haBase}/api/services/remote/turn_on`, {
          method: "POST",
          headers: haHeaders,
          body: JSON.stringify({ entity_id: "remote.living_room_tv" }),
        });
        await new Promise(r => setTimeout(r, 5000));
      }

      const res = await fetch(`${haBase}/api/services/remote/turn_on`, {
        method: "POST",
        headers: haHeaders,
        body: JSON.stringify({ entity_id: "remote.living_room_tv", activity: pkg }),
      });
      if (!res.ok) throw new Error(`HA API ${res.status}`);
      log.info({ conversationId, tool: "open_tv_app", app }, "Open TV app result");
      return `Opened ${app} on the TV.`;
    } catch (err: any) {
      log.error({ conversationId, tool: "open_tv_app", app, err: err.message }, "Open TV app error");
      return `Failed to open ${app}: ${err.message}`;
    }
  }

  if (name === "tv_remote_command") {
    const command = args.command as string;
    const keycode = REMOTE_COMMANDS[command];
    if (!keycode) return `Unknown remote command: ${command}`;
    log.info({ conversationId, tool: "tv_remote_command", command, keycode }, "Tool call: TV remote command");
    try {
      const res = await fetch(`${haBase}/api/services/remote/send_command`, {
        method: "POST",
        headers: haHeaders,
        body: JSON.stringify({ entity_id: "remote.living_room_tv", command: keycode }),
      });
      if (!res.ok) throw new Error(`HA API ${res.status}`);
      // Ambiguous phrasing here (e.g. "Sent home to the TV") reads as a normal
      // English sentence and has confused the model into asking the user to
      // clarify their own tool result - use unambiguous, command-specific text.
      const confirmations: Record<string, string> = {
        home: "Exited to the TV home screen.",
        back: "Went back on the TV.",
        mute: "Toggled TV mute.",
        search: "Opened search on the TV.",
      };
      const result = confirmations[command] ?? `TV remote command "${command}" sent.`;
      log.info({ conversationId, tool: "tv_remote_command", result }, "TV remote command result");
      return result;
    } catch (err: any) {
      log.error({ conversationId, tool: "tv_remote_command", command, err: err.message }, "TV remote command error");
      return `Failed to send ${command}: ${err.message}`;
    }
  }

  if (name === "tv_send_text") {
    const text = args.text as string;
    log.info({ conversationId, tool: "tv_send_text", text }, "Tool call: TV text input");
    try {
      const res = await fetch(`${haBase}/api/services/remote/send_command`, {
        method: "POST",
        headers: haHeaders,
        body: JSON.stringify({ entity_id: "remote.living_room_tv", command: `text:${text}` }),
      });
      if (!res.ok) throw new Error(`HA API ${res.status}`);
      log.info({ conversationId, tool: "tv_send_text" }, "TV text input result");
      return `Typed "${text}" on the TV.`;
    } catch (err: any) {
      log.error({ conversationId, tool: "tv_send_text", err: err.message }, "TV text input error");
      return `Failed to type text: ${err.message}`;
    }
  }

  if (name === "get_device_state") {
    const entityId = args.entity_id as string;
    log.info({ conversationId, tool: "get_device_state", entityId }, "Tool call: device state");
    try {
      const res = await fetch(`${haBase}/api/states/${entityId}`, {
        headers: { Authorization: `Bearer ${haToken}` },
      });
      if (!res.ok) throw new Error(`HA API ${res.status}`);
      const state = await res.json() as { state: string; attributes: Record<string, unknown> };
      return JSON.stringify({ state: state.state, attributes: state.attributes });
    } catch (err: any) {
      log.error({ conversationId, tool: "get_device_state", entityId, err: err.message }, "Device state error");
      return `Error fetching state: ${err.message}`;
    }
  }

  if (name === "run_routine") {
    const scriptId = args.script_id as string;
    log.info({ conversationId, tool: "run_routine", scriptId }, "Tool call: routine");
    try {
      const res = await fetch(`${haBase}/api/services/script/turn_on`, {
        method: "POST",
        headers: haHeaders,
        body: JSON.stringify({ entity_id: `script.${scriptId}` }),
      });
      if (!res.ok) throw new Error(`HA API ${res.status}: ${await res.text()}`);
      log.info({ conversationId, tool: "run_routine", scriptId }, "Routine triggered");
      return `Routine "${scriptId}" started.`;
    } catch (err: any) {
      log.error({ conversationId, tool: "run_routine", scriptId, err: err.message }, "Routine error");
      return `Routine failed: ${err.message}`;
    }
  }

  if (name === "get_context") {
    const page = args.page as string;
    log.info({ conversationId, tool: "get_context", page }, "Tool call: get_context");
    try {
      const content = await fs.readFile(`/wiki/${page}.md`, "utf-8");
      return content;
    } catch (err: any) {
      log.warn({ conversationId, tool: "get_context", page, err: err.message }, "get_context page not found");
      return `No knowledge base page found for "${page}". Available pages are listed in the system prompt.`;
    }
  }

  if (name === "create_knowledge") {
    const filename = (args.filename as string).replace(/[^a-z0-9_-]/gi, "_");
    const content = args.content as string;
    const docsDir = "/wiki/sakke-knowledge";
    const filePath = `${docsDir}/${filename}.md`;
    const indexPath = "/wiki/sakke-knowledge/sakke-index.md";
    log.info({ conversationId, tool: "create_knowledge", filename }, "Tool call: create_knowledge");
    try {
      await fs.mkdir(docsDir, { recursive: true });
      const isNew = !await fs.access(filePath).then(() => true).catch(() => false);
      await fs.writeFile(filePath, content);
      if (isNew) await fs.appendFile(indexPath, `- [[sakke-knowledge/${filename}]]\n`);
      log.info({ conversationId, tool: "create_knowledge", filename, isNew }, "Knowledge note saved");
      return `Saved note "${filename}".`;
    } catch (err: any) {
      log.error({ conversationId, tool: "create_knowledge", filename, err: err.message }, "create_knowledge error");
      return `Failed to save note: ${err.message}`;
    }
  }

  if (name === "timer") {
    const { action, duration_minutes, label, timer_id } = args as {
      action: string;
      duration_minutes?: number;
      label?: string;
      timer_id?: string;
    };
    log.info({ conversationId, tool: "timer", action }, "Tool call: timer");

    if (action === "set") {
      if (!duration_minutes || duration_minutes <= 0) return "Duration is required to set a timer.";
      const mins = Math.round(duration_minutes);
      const timerLabel = label ?? "timer";
      setTimer(mins * 60 * 1000, timerLabel);
      const human = mins === 1 ? "1 minute" : `${mins} minutes`;
      return `Timer set for ${human}. Label: ${timerLabel}.`;
    }

    if (action === "cancel") {
      const active = listTimers();
      if (active.length === 0) return "No active timers.";
      const key = timer_id ?? (active.length === 1 ? active[0].id : "");
      if (!key) {
        return `Multiple timers active: ${active.map(t => `${t.id} (${t.label})`).join(", ")}. Specify a timer ID to cancel.`;
      }
      const cancelled = cancelTimer(key);
      return cancelled ? `Cancelled timer: ${cancelled}.` : "Timer not found.";
    }

    if (action === "list") {
      const active = listTimers();
      if (active.length === 0) return "No active timers.";
      return active.map(t => {
        const remaining = Math.max(0, Math.round(t.remainingMs / 1000 / 60));
        return `${t.id}: "${t.label}" — ${remaining} minute${remaining !== 1 ? "s" : ""} remaining`;
      }).join("\n");
    }

    return `Unknown timer action: ${action}`;
  }

  if (name === "refresh_home_data") {
    log.info({ conversationId, tool: "refresh_home_data" }, "Tool call: refresh home data");
    try {
      await loadEntities();
      const areas = getAreas().map(a => a.name).join(", ") || "none";
      const scenes = getScenes().map(s => s.name).join(", ") || "none";
      const scripts = getScripts().map(s => s.name).join(", ") || "none";
      log.info(
        { conversationId, tool: "refresh_home_data", areas: getAreas().length, scenes: getScenes().length, scripts: getScripts().length },
        "Home data refreshed",
      );
      return `Reloaded home data.\nAreas: ${areas}\nScenes: ${scenes}\nRoutines: ${scripts}`;
    } catch (err: any) {
      log.error({ conversationId, tool: "refresh_home_data", err: err.message }, "Refresh home data error");
      return `Failed to refresh home data: ${err.message}`;
    }
  }

  if (name === "set_gaming_mode") {
    const mode = args.mode as string;
    const pcOllamaUrl = process.env.PC_OLLAMA_BASE_URL;
    log.info({ conversationId, tool: "set_gaming_mode", mode }, "Tool call: set gaming mode");
    if (!pcOllamaUrl) return "GPU routing to your PC isn't configured, so there's nothing to override.";

    if (mode === "gaming") {
      // The override itself is purely local state - it can't fail. Freeing
      // VRAM on the PC is best-effort on top of it: if the PC is asleep/
      // unreachable, that's fine, there's nothing loaded there to free.
      setManualOverride("busy");
      try {
        await unloadPcOllamaModels(pcOllamaUrl, log);
      } catch (err: any) {
        log.warn({ conversationId, tool: "set_gaming_mode", err: err.message }, "Couldn't reach PC to unload VRAM");
      }
      return "Got it, I'll leave your PC's GPU alone.";
    }
    if (mode === "free") {
      clearManualOverride();
      return "Okay, I'll go back to automatically checking if your PC's GPU is free.";
    }
    return `Unknown gaming mode: ${mode}`;
  }

  if (name === "web_search") {
    const query = args.query as string;
    log.info({ conversationId, tool: "web_search", query }, "Tool call: web search");
    try {
      const result = await webSearch(query);
      log.info({ conversationId, tool: "web_search", preview: result.slice(0, 200) }, "Web search result");
      return result;
    } catch (err: any) {
      log.error({ conversationId, tool: "web_search", err: err.message }, "Web search error");
      return `Search failed: ${err.message}`;
    }
  }

  log.warn({ conversationId, tool: name }, "Unknown tool requested");
  return `Unknown tool: ${name}`;
}
