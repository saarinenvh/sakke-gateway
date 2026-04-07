import type { FastifyBaseLogger } from "fastify";
import { dispatch } from "./homeAssistant.js";
import { webSearch } from "./webSearch.js";
import { getWeather } from "./weather.js";
import { getLights, getAreas, getScenes } from "./entityRegistry.js";
import { getTodoLists, readList, addToList, completeInList, removeFromList } from "./lists.js";
import { spotifySearchAndPlay, spotifyPlay, spotifyPause, spotifyNext, spotifyPrevious, spotifyVolume } from "./spotify.js";
import { getTasksText, getCalendarText } from "./reminders.js";
import type { Intent } from "../types/intent.js";

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const model = process.env.OLLAMA_MODEL ?? "qwen3:8b";

const CONVERSATION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ITERATIONS = 6;

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

const conversations = new Map<string, { messages: Message[]; lastActive: number }>();

function pruneStale(): void {
  const now = Date.now();
  for (const [id, conv] of conversations) {
    if (now - conv.lastActive > CONVERSATION_TIMEOUT_MS) {
      conversations.delete(id);
    }
  }
}

async function buildSystemPrompt(): Promise<string> {
  const areas = getAreas().map(a => `  - ${a.name} (${a.area_id})`).join("\n");
  const scenes = getScenes().map(s => `  - ${s.name} (${s.scene_id})`).join("\n");
  const lists = (await getTodoLists()).map(l => `  - ${l.name} (${l.entity_id})`).join("\n");

  return `You are Sakke, a home assistant with the personality of a deadpan butler meets grumpy dwarf. Helpful but reluctant about it. Dry humor, wit, short punchy responses — 1-3 sentences max.

You have tools to control the home, search the web, get weather, and manage lists. Rules:
- Always use control_home_assistant for any home control — never just describe what you'd do.
- Always use get_weather when asked about weather — never guess or use training knowledge.
- Always use web_search for current facts or news — never answer from memory alone.
- Always use manage_list for any todo or shopping list actions — never just describe what you'd do.
- Use get_tasks for tasks/chores/to-dos. Use get_calendar for calendar events/appointments. These are different — do not confuse them.
- Always use spotify for any music control or search — never just describe what you'd do.
- Always respond in metric units (Celsius, km/h, mm). Never convert to imperial.
- Current year is 2026. If asked about recent events, current standings, prices, or anything that may have changed — use web_search instead of relying on training knowledge.

For general conversation — coding ideas, architecture discussions, random questions — just respond naturally. You're opinionated and smart.

Morning routine — when user says "good morning" or similar:
1. Call control_home_assistant with action morning_routine (lights + scene)
2. Call get_tasks to get today's pending tasks
3. Call get_calendar to get today's calendar events
4. Greet them with a brief summary of the day — tasks and events in a few words
5. Then ask if they set up the coffee maker last night and if they want it turned on
6. Wait for their answer — if yes, call control_home_assistant with switch_on on switch.coffee_maker; if no, give a dry remark about their life choices

Available areas:
${areas}

Available scenes:
${scenes}

Available lists:
${lists}

Store layout (grocery items are sorted in this order automatically):
1. Produce (fruits, vegetables, herbs)
2. Bakery (bread, rolls, pastries)
3. Meat & Fish
4. Dairy & Eggs
5. Frozen
6. Canned & Dry Goods (pasta, rice, sauces, spices)
7. Drinks
8. Household & Cleaning`;
}

const tools = [
  {
    type: "function",
    function: {
      name: "control_home_assistant",
      description: "Control smart home devices: lights, scenes, media, switches, routines",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "light_on", "light_off", "light_dim", "light_color",
              "scene_activate", "scene_create", "scene_design",
              "switch_on", "switch_off",
              "media_play", "media_pause", "media_stop", "media_volume",
              "morning_routine", "bedtime_routine",
            ],
          },
          area: { type: "string", description: "Room area id e.g. living_room" },
          device: { type: "string", description: "Specific entity_id" },
          scene: { type: "string", description: "Scene id for scene_activate" },
          scene_name: { type: "string", description: "Name for scene_create" },
          scene_description: { type: "string", description: "Atmosphere description for scene_design" },
          brightness: { type: "number", description: "0-255 for light_dim" },
          color: { type: "string", description: "Color name for light_color" },
          volume: { type: "number", description: "0-100 for media_volume" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current information, facts, news",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather and forecast for the user's location (Espoo, Finland)",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "spotify",
      description: "Control Spotify playback or search and play music",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["play", "pause", "next", "previous", "volume", "search_and_play"],
          },
          query: { type: "string", description: "Search query for search_and_play" },
          type: {
            type: "string",
            enum: ["track", "artist", "playlist", "album"],
            description: "Type of content to search for",
          },
          volume: { type: "number", description: "0-100 for volume action" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "manage_list",
      description: "Read, add, complete, or remove items from todo and shopping lists",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list_read", "list_add", "list_complete", "list_remove"],
          },
          list: { type: "string", description: "Entity ID of the list, e.g. todo.groceries" },
          items: { type: "array", items: { type: "string" }, description: "Items to add (for list_add)" },
          item: { type: "string", description: "Item name to complete or remove" },
        },
        required: ["action", "list"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tasks",
      description: "Get pending items from Google Tasks (todo list). Use ONLY for tasks, chores, or to-dos — things the user needs to DO. NOT for calendar events or appointments.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["today", "tomorrow", "this_week", "next_week"],
            description: "Time period to fetch tasks for. Defaults to today.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_calendar",
      description: "Get events from Google Calendar. Use ONLY for calendar events, appointments, meetings, or scheduled events — things happening at a specific time. NOT for tasks or to-dos.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["today", "tomorrow", "this_week", "next_week"],
            description: "Time period to fetch events for. Defaults to today.",
          },
        },
        required: [],
      },
    },
  },
];

async function executeTool(
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
        const toAdd = items?.length ? items : item ? [item] : [];
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

const NO_CONTINUE_TOOLS = new Set(["spotify"]);
const NO_CONTINUE_SPOTIFY_ACTIONS = new Set(["play", "search_and_play"]);

export async function runAgent(
  userMessage: string,
  conversationId: string,
  log: FastifyBaseLogger,
): Promise<{ content: string; continueConversation: boolean }> {
  pruneStale();

  const existing = conversations.get(conversationId);
  const messages: Message[] = existing?.messages ?? [
    { role: "system", content: await buildSystemPrompt() },
  ];

  messages.push({ role: "user", content: userMessage });
  log.info({ conversationId, turns: messages.length - 1 }, "🤖 Agent started");

  let stopConversation = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    log.info({ iteration: i + 1 }, "📡 Calling Ollama");

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        tools,
        stream: false,
        options: { temperature: 0.7, num_predict: 500 },
      }),
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);

    const json = await res.json() as { message: Message & { tool_calls?: OllamaToolCall[] } };
    const message = json.message;

    if (message.tool_calls?.length) {
      log.info(
        { tools: message.tool_calls.map(t => `${t.function.name}(${JSON.stringify(t.function.arguments)})`) },
        "🛠️  Tool calls requested",
      );

      messages.push(message);

      for (const call of message.tool_calls) {
        if (NO_CONTINUE_TOOLS.has(call.function.name)) {
          const action = call.function.arguments?.action as string | undefined;
          if (!action || NO_CONTINUE_SPOTIFY_ACTIONS.has(action)) {
            stopConversation = true;
          }
        }
        const result = await executeTool(call.function.name, call.function.arguments, log);
        messages.push({ role: "tool", content: result, tool_call_id: call.id });
      }

      continue;
    }

    const content = message.content?.trim() ?? "I got nothing.";
    messages.push({ role: "assistant", content });
    conversations.set(conversationId, { messages, lastActive: Date.now() });

    log.info({ conversationId, turns: messages.length - 1, response: content }, "💬 Agent response");
    return { content, continueConversation: !stopConversation };
  }

  return { content: "I got confused trying to answer that.", continueConversation: !stopConversation };
}
