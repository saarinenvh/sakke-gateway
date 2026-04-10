import type { FastifyBaseLogger } from "fastify";
import { tools } from "../tools/definitions.js";
import { executeTool } from "../tools/executor.js";
import { buildSystemPrompt } from "../prompts/systemPrompt.js";
import { broadcastState } from "./displayState.js";

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const model = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const think = process.env.OLLAMA_THINK === "true" ? true : process.env.OLLAMA_THINK === "false" ? false : undefined;

const CONVERSATION_TIMEOUT_MS = 10 * 60 * 1000;
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

const conversations = new Map<string, { messages: Message[]; lastActive: number; chatMode: boolean }>();

function pruneStale(): void {
  const now = Date.now();
  for (const [id, conv] of conversations) {
    if (now - conv.lastActive > CONVERSATION_TIMEOUT_MS) {
      conversations.delete(id);
    }
  }
}

const CHAT_MODE_PHRASES = new Set([
  "let's chat", "lets chat", "let's talk", "lets talk",
  "let's discuss", "lets discuss", "chat mode", "talk to me",
  "i want to chat", "i want to talk",
]);

const RESET_PHRASES = new Set([
  "let's start fresh", "lets start fresh", "start fresh",
  "new conversation", "start over", "let's start over", "lets start over",
  "forget everything", "reset",
]);

function normalizePunctuation(text: string): string {
  return text.trim().toLowerCase().replace(/[!.,]+$/, "");
}

function isChatModeRequest(text: string): boolean {
  return CHAT_MODE_PHRASES.has(normalizePunctuation(text));
}

function isResetRequest(text: string): boolean {
  return RESET_PHRASES.has(normalizePunctuation(text));
}

export async function runAgent(
  userMessage: string,
  conversationId: string,
  log: FastifyBaseLogger,
): Promise<{ content: string; continueConversation: boolean }> {
  pruneStale();

  if (isResetRequest(userMessage)) {
    conversations.delete(conversationId);
    log.info({ conversationId }, "🔄 Conversation reset");
    const reply = "Fine. Wiped. We never spoke.";
    broadcastState("speaking", Math.max(2000, reply.length * 70));
    return { content: reply, continueConversation: false };
  }

  const existing = conversations.get(conversationId);
  const messages: Message[] = existing?.messages ?? [
    { role: "system", content: await buildSystemPrompt() },
  ];

  const chatMode = existing?.chatMode ?? isChatModeRequest(userMessage);

  messages.push({ role: "user", content: userMessage });
  log.info({ conversationId, turns: messages.length - 1, chatMode }, "🤖 Agent started");
  broadcastState("thinking");

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
        ...(think !== undefined && { think }),
        options: { temperature: 0.7, num_predict: 2000 },
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

    const content = (message.content ?? "I got nothing.")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<channel\|>[\s\S]*/gi, "")
      .trim() || "I got nothing.";

    messages.push({ role: "assistant", content });
    conversations.set(conversationId, { messages, lastActive: Date.now(), chatMode });

    const asksQuestion = content.trimEnd().endsWith("?");
    log.info({ conversationId, turns: messages.length - 1, response: content, chatMode, asksQuestion }, "💬 Agent response");
    const speakingMs = Math.max(2000, content.length * 70);
    broadcastState("speaking", speakingMs);
    return { content, continueConversation: chatMode || asksQuestion };
  }

  return { content: "I got confused trying to answer that.", continueConversation: chatMode };
}
