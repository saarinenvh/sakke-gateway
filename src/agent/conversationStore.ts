import { tools } from "../tools/registry.js";
import { clearSpotifySuggestion } from "../spotify/spotify.js";

export interface OllamaToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: OllamaToolCall[];
}

export interface Conversation {
  messages: Message[];
  lastActive: number;
  chatMode: boolean;
  awaitingContinuation: boolean;
}

const CONVERSATION_TIMEOUT_MS = 10 * 60 * 1000;

const conversations = new Map<string, Conversation>();

export function getConversation(id: string): Conversation | undefined {
  return conversations.get(id);
}

/** Commits a finished turn. Stamps lastActive, so the idle window restarts here. */
export function saveConversation(
  id: string,
  conv: { messages: Message[]; chatMode: boolean; awaitingContinuation: boolean },
): void {
  conversations.set(id, { ...conv, lastActive: Date.now() });
}

// Deliberately leaves lastActive alone: a noise utterance shouldn't hold a
// conversation open. The idle window keeps counting from the last real turn.
export function clearAwaitingContinuation(id: string): void {
  const existing = conversations.get(id);
  if (existing) conversations.set(id, { ...existing, awaitingContinuation: false });
}

// Forgetting a conversation means forgetting everything keyed by its id. The
// Spotify suggestion map was keyed by the same id but only ever cleared on an
// explicit reset or a new_request verdict, so timed-out conversations left
// entries behind for the lifetime of the process - and timers.ts mints a fresh
// conversation id per timer. Bundling the two here is what stops a fourth
// call site forgetting again.
export function dropConversation(id: string): void {
  conversations.delete(id);
  clearSpotifySuggestion(id);
}

export function pruneStale(): void {
  const now = Date.now();
  for (const [id, conv] of conversations) {
    if (now - conv.lastActive > CONVERSATION_TIMEOUT_MS) dropConversation(id);
  }
}

// A fixed num_ctx alone only raises the ceiling - a conversation left running
// (chat mode, or just repeated follow-ups inside the 10-minute idle window)
// grows without bound otherwise and will eventually hit it anyway. No real
// tokenizer here, so this uses a ~4-chars-per-token heuristic with a safety
// margin - approximate on purpose, trimming a turn earlier than strictly
// necessary is harmless, but truncating mid-request (the original bug) isn't.
const CHARS_PER_TOKEN = 4;
const RESPONSE_RESERVE_TOKENS = 2000; // matches num_predict
const SAFETY_MARGIN_TOKENS = 300; // chat template / role overhead, not reflected in raw content length

// The tool schemas ride along with every request and are a meaningful share of
// the budget, so the trimmer reads them itself rather than trusting each call
// site to subtract them.
const TOOLS_JSON_CHARS = JSON.stringify(tools).length;

function messageChars(m: Message): number {
  return (m.content?.length ?? 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
}

// Drops the oldest whole turns (a user message through everything before the
// next user message - keeps assistant/tool_call pairs intact so no tool
// message is ever left dangling without its originating assistant message)
// once accumulated history threatens to overflow num_ctx. Always keeps the
// system prompt and the in-progress turn, even if that alone is oversized -
// there's nothing sensible left to trim in that case.
export function contextBudgetChars(numCtx: number): number {
  return (numCtx - RESPONSE_RESERVE_TOKENS - SAFETY_MARGIN_TOKENS) * CHARS_PER_TOKEN - TOOLS_JSON_CHARS;
}

export function trimConversationHistory(messages: Message[], numCtx: number): void {
  const budgetChars = contextBudgetChars(numCtx);
  if (budgetChars <= 0) return;

  // Counts the system prompt too. It used to be excluded (slice(1)), which
  // meant the budget ignored the single largest block in the conversation -
  // it carries every area, scene, script and list plus the whole wiki index,
  // and grows every time one of those is added. Undercounting it is exactly
  // how a context overflow sneaks back in, which is the thing this function
  // exists to prevent.
  let total = messages.reduce((sum, m) => sum + messageChars(m), 0);

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

export function isChatModeRequest(text: string): boolean {
  return CHAT_MODE_PHRASES.has(normalizePunctuation(text));
}

export function isResetRequest(text: string): boolean {
  return RESET_PHRASES.has(normalizePunctuation(text));
}

/** Test seam: the store is process-global, so suites must be able to reset it. */
export function __clearAllConversations(): void {
  conversations.clear();
}
