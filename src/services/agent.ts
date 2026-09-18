import type { FastifyBaseLogger } from "fastify";
import { tools } from "../tools/definitions.js";
import { executeTool } from "../tools/executor.js";
import { buildSystemPrompt } from "../prompts/systemPrompt.js";
import { broadcastState } from "./displayState.js";
import { classifyFollowUp } from "./continuationCheck.js";
import { clearSpotifySuggestion } from "./integrations/spotify.js";
import { getGpuStatus } from "./gpuStatus.js";

interface OllamaTarget {
  baseUrl: string;
  model: string;
  numCtx: number;
  think: boolean | undefined;
  keepAlive: string | undefined;
}

function parseThink(value: string | undefined): boolean | undefined {
  return value === "true" ? true : value === "false" ? false : undefined;
}

// Without an explicit num_ctx, Ollama's default context window is small
// enough that the system prompt + full tool schema (+ accumulated tool
// results in longer tool-calling turns) can get silently truncated -
// confirmed directly against gpt-oss:20b: the same real prompt/tools
// evaluated only ~2050 tokens and produced a hallucinated, tool-call-free
// response, vs. the correct tool call once num_ctx was set large enough to
// actually fit the prompt (~8800 tokens). The models themselves support far
// more (qwen3 up to 256K, gpt-oss up to 128K) - the real ceiling is VRAM for
// the KV cache, which differs a lot per GPU/model, so this stays
// env-overridable per deployment rather than fixed.
const serverTarget: OllamaTarget = {
  baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  model: process.env.OLLAMA_MODEL ?? "qwen3:8b",
  numCtx: Number(process.env.OLLAMA_NUM_CTX ?? "32768"),
  think: parseThink(process.env.OLLAMA_THINK),
  // Left unset (Ollama's own default keep-alive, normally 5min) unless
  // explicitly configured - the server is dedicated to Sakke, so there's no
  // reason to be eager about freeing its VRAM the way the PC target is.
  keepAlive: process.env.OLLAMA_KEEP_ALIVE,
};

// Only defined if PC_OLLAMA_BASE_URL is actually set - otherwise routing
// always falls back to the server, same as before Phase 3 existed.
const pcTarget: OllamaTarget | null = process.env.PC_OLLAMA_BASE_URL
  ? {
      baseUrl: process.env.PC_OLLAMA_BASE_URL,
      model: process.env.PC_OLLAMA_MODEL ?? serverTarget.model,
      numCtx: Number(process.env.PC_OLLAMA_NUM_CTX ?? "32768"),
      think: parseThink(process.env.PC_OLLAMA_THINK),
      // Left unset by default, same as the server target - a short default
      // here would force a cold reload on every single PC-routed request,
      // including consecutive ones seconds apart within the same
      // conversation. Freeing VRAM when something else needs it (a game
      // starting) is instead handled proactively by status-service.ps1 on
      // the PC itself, right at the moment it detects the GPU going busy -
      // see that script's Unload-OllamaModels function.
      keepAlive: process.env.PC_OLLAMA_KEEP_ALIVE,
    }
  : null;

// Per gpu_routing_design.md: the routing check happens once per conversation
// turn, not continuously mid-generation or per tool-call iteration within a
// turn - a game starting mid-response is an accepted small risk, not
// engineered around. "busy" and "unknown" (stale/no heartbeat yet, or no PC
// configured at all) both fail closed to the always-on server model -
// preferring the recoverable outcome over guessing wrong about whether the
// PC is actually reachable.
function getOllamaTarget(log: FastifyBaseLogger): OllamaTarget {
  if (!pcTarget) return serverTarget;

  const gpu = getGpuStatus();
  if (gpu.state === "available") {
    log.info({ gpuSource: gpu.source, gpuLastSeen: gpu.lastSeen }, "Routing to PC");
    return pcTarget;
  }

  log.info({ gpuState: gpu.state, gpuStaleMs: gpu.staleMs }, "Routing to server");
  return serverTarget;
}

const CONVERSATION_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ITERATIONS = 6;

// A fixed num_ctx alone only raises the ceiling - a conversation left running
// (chat mode, or just repeated follow-ups inside the 10-minute idle window)
// grows without bound otherwise and will eventually hit it anyway. No real
// tokenizer here, so this uses a ~4-chars-per-token heuristic with a safety
// margin - approximate on purpose, trimming a turn earlier than strictly
// necessary is harmless, but truncating mid-request (the original bug) isn't.
const CHARS_PER_TOKEN = 4;
const TOOLS_JSON_CHARS = JSON.stringify(tools).length;
const RESPONSE_RESERVE_TOKENS = 2000; // matches num_predict
const SAFETY_MARGIN_TOKENS = 300; // chat template / role overhead, not reflected in raw content length

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

const conversations = new Map<string, {
  messages: Message[];
  lastActive: number;
  chatMode: boolean;
  awaitingContinuation: boolean;
}>();

function pruneStale(): void {
  const now = Date.now();
  for (const [id, conv] of conversations) {
    if (now - conv.lastActive > CONVERSATION_TIMEOUT_MS) {
      conversations.delete(id);
    }
  }
}

function messageChars(m: Message): number {
  return (m.content?.length ?? 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
}

// Drops the oldest whole turns (a user message through everything before the
// next user message - keeps assistant/tool_call pairs intact so no tool
// message is ever left dangling without its originating assistant message)
// once accumulated history threatens to overflow num_ctx. Always keeps the
// system prompt and the in-progress turn, even if that alone is oversized -
// there's nothing sensible left to trim in that case.
function trimConversationHistory(messages: Message[], numCtx: number): void {
  const budgetChars = (numCtx - RESPONSE_RESERVE_TOKENS - SAFETY_MARGIN_TOKENS) * CHARS_PER_TOKEN - TOOLS_JSON_CHARS;
  if (budgetChars <= 0) return;

  let total = messages.slice(1).reduce((sum, m) => sum + messageChars(m), 0);

  while (total > budgetChars) {
    const turnStart = messages.findIndex((m, i) => i > 0 && m.role === "user");
    if (turnStart === -1) break;
    const turnEnd = messages.findIndex((m, i) => i > turnStart && m.role === "user");
    if (turnEnd === -1) break; // only the in-progress turn remains - stop
    const removed = messages.splice(turnStart, turnEnd - turnStart);
    total -= removed.reduce((sum, m) => sum + messageChars(m), 0);
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
    clearSpotifySuggestion(conversationId);
    log.info({ conversationId, userMessage }, "Conversation reset");
    const reply = "Fine. Wiped. We never spoke.";
    broadcastState("speaking", Math.max(2000, reply.length * 70));
    return { content: reply, continueConversation: false };
  }

  let existing = conversations.get(conversationId);

  if (existing?.awaitingContinuation && !existing.chatMode) {
    const lastAssistantMessage = [...existing.messages].reverse().find(m => m.role === "assistant")?.content ?? "";
    const lastUserMessage = [...existing.messages].reverse().find(m => m.role === "user")?.content ?? "";
    const verdict = await classifyFollowUp(lastUserMessage, lastAssistantMessage, userMessage, log);

    if (verdict === "noise") {
      log.info({ conversationId, userMessage }, "Utterance deemed noise, staying silent");
      conversations.set(conversationId, { ...existing, awaitingContinuation: false });
      broadcastState("idle");
      return { content: "", continueConversation: false };
    }

    if (verdict === "new_request") {
      // A real request, just off-topic vs. the last exchange - respond to it
      // fresh instead of dragging in irrelevant prior context (or, worse,
      // silencing it the way "noise" does).
      log.info({ conversationId, userMessage }, "New unrelated request detected, starting fresh conversation");
      conversations.delete(conversationId);
      clearSpotifySuggestion(conversationId);
      existing = undefined;
    }
  }

  const messages: Message[] = existing?.messages ?? [
    { role: "system", content: await buildSystemPrompt() },
  ];

  const chatMode = existing?.chatMode ?? isChatModeRequest(userMessage);

  messages.push({ role: "user", content: userMessage });

  // Decided once per turn, not per tool-call iteration within it - see
  // getOllamaTarget's own comment for why.
  const target = getOllamaTarget(log);

  const beforeTrim = messages.length;
  trimConversationHistory(messages, target.numCtx);
  if (messages.length < beforeTrim) {
    log.info({ conversationId, droppedMessages: beforeTrim - messages.length }, "Trimmed old conversation history to fit num_ctx");
  }

  log.info({ conversationId, userMessage, model: target.model, baseUrl: target.baseUrl, turns: messages.length - 1, chatMode }, "Agent started");
  broadcastState("thinking");

  const completedToolCalls = new Set<string>();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    log.info({ conversationId, iteration: i + 1 }, "Calling Ollama");

    const res = await fetch(`${target.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: target.model,
        messages,
        tools,
        stream: false,
        ...(target.think !== undefined && { think: target.think }),
        ...(target.keepAlive !== undefined && { keep_alive: target.keepAlive }),
        options: { temperature: 0.7, num_predict: 2000, num_ctx: target.numCtx },
      }),
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);

    const json = await res.json() as { message: Message & { tool_calls?: OllamaToolCall[] } };
    const message = json.message;

    if (message.tool_calls?.length) {
      // Detect repeated identical tool calls — model is stuck in a loop
      const callKeys = message.tool_calls.map(t => `${t.function.name}:${JSON.stringify(t.function.arguments)}`);
      const alreadyDone = callKeys.every(k => completedToolCalls.has(k));
      if (alreadyDone) {
        log.warn({ conversationId, tools: callKeys }, "Duplicate tool calls detected, forcing response");
        break;
      }
      callKeys.forEach(k => completedToolCalls.add(k));

      log.info(
        { conversationId, tools: message.tool_calls.map(t => `${t.function.name}(${JSON.stringify(t.function.arguments)})`) },
        "Tool calls requested",
      );

      messages.push(message);

      for (const call of message.tool_calls) {
        const result = await executeTool(call.function.name, call.function.arguments, log, conversationId);
        messages.push({ role: "tool", content: result, tool_call_id: call.id });
      }

      continue;
    }

    const content = (message.content ?? "I got nothing.")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<channel\|>[\s\S]*/gi, "")
      // The model doesn't reliably follow the "no markdown" voice rule on its
      // own (confirmed even after reinforcing it) - strip it deterministically
      // instead of continuing to depend on prompt compliance for something a
      // TTS voice would otherwise read literally (asterisks, list numbers, etc).
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/^\s*#{1,6}\s+/gm, "")
      .replace(/^\s*[-*]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      // Turn line breaks into sentence breaks (not spaces) so former list items
      // get spoken with natural pauses instead of running together.
      .replace(/\s*\n+\s*/g, ". ")
      .replace(/[:.]\s*\./g, m => m.trimEnd().slice(0, 1))
      .replace(/ {2,}/g, " ")
      .trim() || "I got nothing.";

    messages.push({ role: "assistant", content });
    conversations.set(conversationId, { messages, lastActive: Date.now(), chatMode, awaitingContinuation: true });

    const asksQuestion = content.trimEnd().endsWith("?");
    log.info({ conversationId, model: target.model, turns: messages.length - 1, response: content, chatMode, asksQuestion }, "Agent response");
    const speakingMs = Math.max(2000, content.length * 70);
    broadcastState("speaking", speakingMs);
    return { content, continueConversation: true };
  }

  log.warn({ conversationId, userMessage, model: target.model, maxIterations: MAX_ITERATIONS }, "Max tool-call iterations exhausted without a final response");
  return { content: "I got confused trying to answer that.", continueConversation: chatMode };
}
