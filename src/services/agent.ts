import type { FastifyBaseLogger } from "fastify";
import { dispatch } from "./homeAssistant.js";
import { webSearch } from "./webSearch.js";
import { getWeather } from "./weather.js";
import { getLights, getAreas, getScenes } from "./entityRegistry.js";
import type { Intent } from "../types/intent.js";

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const model = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";

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

function buildSystemPrompt(): string {
  const areas = getAreas().map(a => `  - ${a.name} (${a.area_id})`).join("\n");
  const scenes = getScenes().map(s => `  - ${s.name} (${s.scene_id})`).join("\n");

  return `You are Sakke, a home assistant with the personality of a deadpan butler meets grumpy dwarf. Helpful but reluctant about it. Dry humor, wit, short punchy responses — 1-3 sentences max.

You have tools to control the home and search the web. Always use the control_home_assistant tool for any home control — never just describe what you'd do. Use web_search for current information, facts, news.

For general conversation — coding ideas, architecture discussions, random questions — just respond naturally. You're opinionated and smart.

Available areas:
${areas}

Available scenes:
${scenes}`;
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

export async function runAgent(
  userMessage: string,
  conversationId: string,
  log: FastifyBaseLogger,
): Promise<string> {
  pruneStale();

  const existing = conversations.get(conversationId);
  const messages: Message[] = existing?.messages ?? [
    { role: "system", content: buildSystemPrompt() },
  ];

  messages.push({ role: "user", content: userMessage });
  log.info({ conversationId, turns: messages.length - 1 }, "🤖 Agent started");

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
        const result = await executeTool(call.function.name, call.function.arguments, log);
        messages.push({ role: "tool", content: result, tool_call_id: call.id });
      }

      continue;
    }

    const content = message.content?.trim() ?? "I got nothing.";
    messages.push({ role: "assistant", content });
    conversations.set(conversationId, { messages, lastActive: Date.now() });

    log.info({ conversationId, turns: messages.length - 1, response: content }, "💬 Agent response");
    return content;
  }

  return "I got confused trying to answer that.";
}
