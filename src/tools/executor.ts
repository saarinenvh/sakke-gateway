import { promises as fs } from "fs";
import type { FastifyBaseLogger } from "fastify";
import { dispatch } from "../services/ha/dispatcher.js";
import { webSearch } from "../services/integrations/webSearch.js";
import { getWeather } from "../services/integrations/weather.js";
import { readList, addToList, completeInList, removeFromList } from "../services/ha/lists.js";
import { spotifySearchAndPlay, spotifyPlay, spotifyPause, spotifyNext, spotifyPrevious, spotifyVolume } from "../services/integrations/spotify.js";
import { getTasksText, getCalendarText } from "../services/ha/reminders.js";
import type { Intent } from "../types/intent.js";

const haBase = process.env.HA_BASE_URL ?? "http://localhost:8123";
const haToken = process.env.HA_TOKEN ?? "";
const haHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${haToken}` };

const APP_PACKAGES: Record<string, string> = {
  netflix: "com.netflix.ninja",
  youtube: "com.google.android.youtube.tv",
  spotify: "com.spotify.tv.android",
  dgn: "com.discgolfprotour",
};

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  log: FastifyBaseLogger,
): Promise<string> {
  if (name === "control_home_assistant") {
    log.info({ tool: "control_home_assistant", args }, "🔧 Tool call: HA");
    try {
      const intent = { ...args, raw: JSON.stringify(args) } as Intent;
      const result = await dispatch(intent);
      log.info({ result }, "✅ HA tool result");
      return result;
    } catch (err: any) {
      log.error({ err: err.message }, "❌ HA tool error");
      return `Error: ${err.message}`;
    }
  }

  if (name === "get_weather") {
    log.info({ tool: "get_weather" }, "🌤️  Tool call: weather");
    try {
      const result = await getWeather();
      log.info({ result }, "✅ Weather result");
      return result;
    } catch (err: any) {
      log.error({ err: err.message }, "❌ Weather error");
      return `Weather fetch failed: ${err.message}`;
    }
  }

  if (name === "spotify") {
    const { action, query, type, volume } = args as { action: string; query?: string; type?: "track" | "artist" | "playlist" | "album"; volume?: number };
    log.info({ tool: "spotify", action, query }, "🎵 Tool call: Spotify");
    try {
      let result: string;
      if (action === "search_and_play") result = await spotifySearchAndPlay(query ?? "", type ?? "track");
      else if (action === "play") result = await spotifyPlay();
      else if (action === "pause") result = await spotifyPause();
      else if (action === "next") result = await spotifyNext();
      else if (action === "previous") result = await spotifyPrevious();
      else if (action === "volume") result = await spotifyVolume(volume ?? 50);
      else result = `Unknown spotify action: ${action}`;
      log.info({ result }, "✅ Spotify result");
      return result;
    } catch (err: any) {
      log.error({ err: err.message }, "❌ Spotify error");
      return `Spotify failed: ${err.message}`;
    }
  }

  if (name === "manage_list") {
    const { action, list, items, item } = args as { action: string; list: string; items?: string[]; item?: string };
    log.info({ tool: "manage_list", action, list }, "📋 Tool call: list");
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
      else result = `Unknown list action: ${action}`;
      log.info({ result }, "✅ List result");
      return result;
    } catch (err: any) {
      log.error({ err: err.message }, "❌ List error");
      return `List operation failed: ${err.message}`;
    }
  }

  if (name === "get_tasks") {
    const period = (args.period as string) ?? "today";
    log.info({ tool: "get_tasks", period }, "✅ Tool call: tasks");
    try {
      return await getTasksText(period);
    } catch (err: any) {
      log.error({ err: err.message }, "❌ Tasks error");
      return `Tasks fetch failed: ${err.message}`;
    }
  }

  if (name === "get_calendar") {
    const period = (args.period as string) ?? "today";
    log.info({ tool: "get_calendar", period }, "📅 Tool call: calendar");
    try {
      return await getCalendarText(period);
    } catch (err: any) {
      log.error({ err: err.message }, "❌ Calendar error");
      return `Calendar fetch failed: ${err.message}`;
    }
  }

  if (name === "open_tv_app") {
    const app = args.app as string;
    const pkg = APP_PACKAGES[app];
    if (!pkg) return `Unknown app: ${app}`;
    log.info({ tool: "open_tv_app", app, pkg }, "📺 Tool call: open TV app");
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
      return `Opened ${app} on the TV.`;
    } catch (err: any) {
      return `Failed to open ${app}: ${err.message}`;
    }
  }

  if (name === "get_device_state") {
    const entityId = args.entity_id as string;
    log.info({ tool: "get_device_state", entityId }, "📡 Tool call: device state");
    try {
      const res = await fetch(`${haBase}/api/states/${entityId}`, {
        headers: { Authorization: `Bearer ${haToken}` },
      });
      if (!res.ok) throw new Error(`HA API ${res.status}`);
      const state = await res.json() as { state: string; attributes: Record<string, unknown> };
      return JSON.stringify({ state: state.state, attributes: state.attributes });
    } catch (err: any) {
      return `Error fetching state: ${err.message}`;
    }
  }

  if (name === "run_routine") {
    const scriptId = args.script_id as string;
    log.info({ tool: "run_routine", scriptId }, "🔁 Tool call: routine");
    try {
      const res = await fetch(`${haBase}/api/services/script/turn_on`, {
        method: "POST",
        headers: haHeaders,
        body: JSON.stringify({ entity_id: `script.${scriptId}` }),
      });
      if (!res.ok) throw new Error(`HA API ${res.status}: ${await res.text()}`);
      log.info({ scriptId }, "✅ Routine triggered");
      return `Routine "${scriptId}" started.`;
    } catch (err: any) {
      log.error({ err: err.message }, "❌ Routine error");
      return `Routine failed: ${err.message}`;
    }
  }

  if (name === "get_context") {
    const page = args.page as string;
    log.info({ page }, "📖 Tool call: get_context");
    try {
      const content = await fs.readFile(`/wiki/${page}.md`, "utf-8");
      return content;
    } catch {
      return `No knowledge base page found for "${page}". Available pages are listed in the system prompt.`;
    }
  }

  if (name === "create_knowledge") {
    const filename = (args.filename as string).replace(/[^a-z0-9_-]/gi, "_");
    const content = args.content as string;
    const docsDir = "/wiki/sakke-knowledge";
    const filePath = `${docsDir}/${filename}.md`;
    const indexPath = "/wiki/sakke-knowledge/sakke-index.md";
    log.info({ filename }, "📝 Tool call: create_knowledge");
    try {
      await fs.mkdir(docsDir, { recursive: true });
      const isNew = !await fs.access(filePath).then(() => true).catch(() => false);
      await fs.writeFile(filePath, content);
      if (isNew) await fs.appendFile(indexPath, `- [[sakke-knowledge/${filename}]]\n`);
      return `Saved note "${filename}".`;
    } catch (err: any) {
      return `Failed to save note: ${err.message}`;
    }
  }

  if (name === "web_search") {
    const query = args.query as string;
    log.info({ tool: "web_search", query }, "🔍 Tool call: web search");
    try {
      const result = await webSearch(query);
      log.info({ preview: result.slice(0, 200) }, "✅ Web search result");
      return result;
    } catch (err: any) {
      log.error({ err: err.message }, "❌ Web search error");
      return `Search failed: ${err.message}`;
    }
  }

  return `Unknown tool: ${name}`;
}
