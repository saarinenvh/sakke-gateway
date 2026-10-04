import type { FastifyBaseLogger } from "fastify";
import { executeTool, isRepeatable, isToolInProfile, toolsForProfile } from "../tools/registry.js";
import type { ConversationProfileName } from "../inference/profiles.js";
import { buildSystemPrompt, refreshClock } from "./systemPrompt.js";
import { broadcastState, speakingDurationMs } from "../features/display/display.js";
import { classifyFollowUp, recentExchanges, type FollowUpVerdict } from "./continuationCheck.js";
import { cleanForSpeech } from "../inference/voiceText.js";
import { getOllamaTarget } from "../inference/ollamaRouter.js";
import { buildSakkeRequest } from "../inference/ollamaRequest.js";
import type { OllamaTargetConfig } from "../config.js";
import { ollamaChat } from "../integrations/ollama/client.js";
import type { Message, OllamaToolCall } from "../integrations/ollama/types.js";
import type { ToolDefinition } from "../tools/types.js";
import {
  type Conversation,
  getConversation,
  saveConversation,
  clearAwaitingContinuation,
  dropConversation,
  pruneStale,
  trimConversationHistory,
  isResetRequest,
} from "./conversationStore.js";

const MAX_ITERATIONS = 6;

export interface AgentOptions {
  // Which tools the model is offered and may call. A tool-less piece of text
  // for a feature is inference/writeText's job, not a conversation.
  profile: ConversationProfileName;
  // Context from whoever started the conversation, e.g. the question the
  // tidiness coach just asked; the reply arrives as a new conversation.
  extraSystemPrompt?: string;
}

export interface AgentResult {
  content: string;
  continueConversation: boolean;
}

type IncomingTurn =
  | { kind: "reset"; reply: string }
  | { kind: "silence" }
  | { kind: "proceed"; messages: Message[] };

// What the tool-calling loop produced, before the turn's completion side
// effects (speech cleanup, persistence, logging, display) have run.
type LoopOutcome =
  | { kind: "answered"; rawContent: string; toolsWereWithheld: boolean }
  | { kind: "exhausted" };

type ToolBatchOutcome = "executed" | "repeated";

export async function runAgent(
  userMessage: string,
  conversationId: string,
  log: FastifyBaseLogger,
  options: AgentOptions,
): Promise<AgentResult> {
  pruneStale();

  const turn = await resolveIncomingTurn(userMessage, conversationId, log, options.extraSystemPrompt);

  if (turn.kind === "reset") {
    broadcastState("speaking", speakingDurationMs(turn.reply));
    return { content: turn.reply, continueConversation: false };
  }

  if (turn.kind === "silence") {
    broadcastState("idle");
    return { content: "", continueConversation: false };
  }

  const { messages } = turn;

  // Decided once per turn, not per iteration - see getOllamaTarget.
  const target = getOllamaTarget(log);
  trimHistoryToFit(messages, target.numCtx, conversationId, log);

  log.info(
    { conversationId, userMessage, model: target.model, baseUrl: target.baseUrl, turns: messages.length - 1 },
    "Agent started",
  );
  broadcastState("thinking");

  let outcome: LoopOutcome;
  try {
    outcome = await runToolCallingLoop(messages, target, conversationId, userMessage, log, options.profile);
  } catch (err) {
    // Only the speaking/idle broadcasts clear "thinking" - a throw must too.
    broadcastState("idle");
    throw err;
  }

  return completeTurn(outcome, messages, target.model, conversationId, log);
}

// --- Turn setup -------------------------------------------------------

async function resolveIncomingTurn(
  userMessage: string,
  conversationId: string,
  log: FastifyBaseLogger,
  extraSystemPrompt: string | undefined,
): Promise<IncomingTurn> {
  if (isResetRequest(userMessage)) {
    dropConversation(conversationId);
    log.info({ conversationId, userMessage }, "Conversation reset");
    return { kind: "reset", reply: "Fine. Wiped. We never spoke." };
  }

  let existing = getConversation(conversationId);

  if (existing?.awaitingContinuation) {
    const verdict = await classifyContinuation(existing, userMessage, log);

    if (verdict === "noise") {
      log.info({ conversationId, userMessage }, "Utterance deemed noise, staying silent");
      clearAwaitingContinuation(conversationId);
      return { kind: "silence" };
    }

    if (verdict === "new_request") {
      // A different topic, not noise - start fresh rather than dragging in
      // irrelevant history or staying silent.
      log.info({ conversationId, userMessage }, "New unrelated request detected, starting fresh conversation");
      dropConversation(conversationId);
      existing = undefined;
    }
  }

  return {
    kind: "proceed",
    messages: await buildMessages(existing, userMessage, extraSystemPrompt),
  };
}

function classifyContinuation(
  existing: Conversation,
  userMessage: string,
  log: FastifyBaseLogger,
): Promise<FollowUpVerdict> {
  return classifyFollowUp(recentExchanges(existing.messages), userMessage, log);
}

async function buildMessages(
  existing: Conversation | undefined,
  userMessage: string,
  extraSystemPrompt: string | undefined,
): Promise<Message[]> {
  // Copies the stored history rather than reusing the same array - a failed
  // turn below must not corrupt the next one's starting point.
  const messages: Message[] = existing
    ? [...existing.messages]
    : [{ role: "system", content: await buildSystemPrompt() }];

  if (existing && messages[0]?.role === "system") {
    messages[0] = { ...messages[0], content: refreshClock(messages[0].content) };
  }

  // Kept in the stored history, so a follow-up still knows the context.
  if (extraSystemPrompt) messages.push({ role: "system", content: extraSystemPrompt });
  messages.push({ role: "user", content: userMessage });
  return messages;
}

function trimHistoryToFit(messages: Message[], numCtx: number, conversationId: string, log: FastifyBaseLogger): void {
  const beforeTrim = messages.length;
  trimConversationHistory(messages, numCtx);
  if (messages.length < beforeTrim) {
    log.info({ conversationId, droppedMessages: beforeTrim - messages.length }, "Trimmed old conversation history to fit num_ctx");
  }
}

// --- Tool-calling loop --------------------------------------------------

// MAX_ITERATIONS passes, plus one extra slot reserved for the forced
// tools-withheld pass so that pass doesn't eat into the model's own budget.
async function runToolCallingLoop(
  messages: Message[],
  target: OllamaTargetConfig,
  conversationId: string,
  userMessage: string,
  log: FastifyBaseLogger,
  profile: ConversationProfileName,
): Promise<LoopOutcome> {
  const completedToolCalls = new Set<string>();
  const tools = toolsForProfile(profile);
  // True once the model repeats itself - see executeToolBatch - and from the
  // start for a profile with no tools.
  let forceFinalResponse = tools.length === 0;

  for (let i = 0; i < MAX_ITERATIONS + 1; i++) {
    if (i === MAX_ITERATIONS && !forceFinalResponse) break;

    log.info({ conversationId, iteration: i + 1, toolsWithheld: forceFinalResponse }, "Calling Ollama");
    const message = await callOllama(messages, target, forceFinalResponse ? [] : tools, log);

    if (message.tool_calls?.length && !forceFinalResponse) {
      const toolCalls = message.tool_calls;
      const outcome = await executeToolBatch(toolCalls, message.content, messages, completedToolCalls, profile, conversationId, log);
      if (outcome === "repeated") forceFinalResponse = true;
      continue;
    }

    return { kind: "answered", rawContent: message.content, toolsWereWithheld: forceFinalResponse };
  }

  log.warn({ conversationId, userMessage, model: target.model, maxIterations: MAX_ITERATIONS }, "Max tool-call iterations exhausted without a final response");
  return { kind: "exhausted" };
}

function callOllama(
  messages: Message[],
  target: OllamaTargetConfig,
  tools: ToolDefinition[],
  log: FastifyBaseLogger,
): Promise<Message> {
  return ollamaChat(target.baseUrl, buildSakkeRequest(messages, target, tools), log);
}

// Keys are marked completed as the batch is processed, not in bulk
// beforehand, so a duplicate within one batch is caught the same way as one
// across batches. Whether the model is "stuck" isn't decided from the keys
// upfront - it's whether processing the batch produced any new result at
// all. A batch that's entirely skipped repeats of non-repeatable calls means
// zero new information reached the model, which is the actual stuck case;
// a batch containing even one new or repeatable call is real progress, even
// if every key in it was already seen before.
async function executeToolBatch(
  toolCalls: OllamaToolCall[],
  assistantContent: string,
  messages: Message[],
  completedToolCalls: Set<string>,
  profile: ConversationProfileName,
  conversationId: string,
  log: FastifyBaseLogger,
): Promise<ToolBatchOutcome> {
  const callKeys = toolCalls.map(t => toolCallKey(t.function.name, t.function.arguments));

  log.info(
    { conversationId, tools: toolCalls.map(t => `${t.function.name}(${JSON.stringify(t.function.arguments)})`) },
    "Tool calls requested",
  );

  messages.push({ role: "assistant", content: assistantContent, tool_calls: toolCalls });

  let anyExecuted = false;

  for (const [i, call] of toolCalls.entries()) {
    const key = callKeys[i];

    if (completedToolCalls.has(key) && !isRepeatable(call.function.name, call.function.arguments)) {
      log.warn({ conversationId, tool: call.function.name }, "Skipped repeat of a non-repeatable tool call");
      messages.push({
        role: "tool",
        content: `${call.function.name} already ran this turn with the same arguments - not repeating it.`,
        tool_call_id: call.id,
      });
      continue;
    }

    anyExecuted = true;
    completedToolCalls.add(key);
    const result = await executeToolInProfile(call, profile, conversationId, log);
    messages.push({ role: "tool", content: result, tool_call_id: call.id });
  }

  if (!anyExecuted) {
    log.warn({ conversationId, tools: callKeys }, "Every call in this batch was a repeat, withholding tools next pass");
    return "repeated";
  }

  return "executed";
}

// A registered tool outside the profile gets the same answer as a made-up one.
function executeToolInProfile(
  call: OllamaToolCall,
  profile: ConversationProfileName,
  conversationId: string,
  log: FastifyBaseLogger,
): Promise<string> {
  const { name, arguments: args } = call.function;
  if (!isToolInProfile(profile, name)) {
    log.warn({ conversationId, tool: name, profile }, "Tool outside the request's profile");
    return Promise.resolve(`Unknown tool: ${name}`);
  }
  return executeTool(name, args, log, conversationId);
}

function toolCallKey(name: string, args: Record<string, unknown>): string {
  return `${name}:${canonicalJson(args)}`;
}

// JSON.stringify preserves property insertion order, not a canonical one - two
// calls with identical arguments but different key order would otherwise
// produce different keys and silently bypass the dedup above.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// Applies the turn's completion side effects - speech cleanup, history
// persistence, logging, the display broadcast - for whichever way the loop
// finished.
function completeTurn(
  outcome: LoopOutcome,
  messages: Message[],
  model: string,
  conversationId: string,
  log: FastifyBaseLogger,
): AgentResult {
  if (outcome.kind === "exhausted") {
    broadcastState("idle");
    return { content: "I got confused trying to answer that.", continueConversation: false };
  }

  const content = cleanForSpeech(outcome.rawContent, outcome.toolsWereWithheld);

  messages.push({ role: "assistant", content });
  saveConversation(conversationId, { messages, awaitingContinuation: true });

  log.info({ conversationId, model, turns: messages.length - 1, response: content }, "Agent response");
  broadcastState("speaking", speakingDurationMs(content));
  return { content, continueConversation: true };
}
