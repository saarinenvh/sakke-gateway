import type { FastifyBaseLogger } from "fastify";
import { tools, executeTool } from "../tools/registry.js";
import { buildSystemPrompt, refreshClock } from "./systemPrompt.js";
import { broadcastState } from "../features/display/displayState.js";
import { classifyFollowUp, type FollowUpVerdict } from "./continuationCheck.js";
import { cleanForSpeech } from "./voiceText.js";
import { getOllamaTarget } from "./ollamaRouter.js";
import type { OllamaTargetConfig } from "../config.js";
import { ollamaChat } from "../integrations/ollama/client.js";
import type { Message, OllamaToolCall } from "../integrations/ollama/types.js";
import {
  type Conversation,
  RESPONSE_RESERVE_TOKENS,
  getConversation,
  saveConversation,
  clearAwaitingContinuation,
  dropConversation,
  pruneStale,
  trimConversationHistory,
  isResetRequest,
} from "./conversationStore.js";

const MAX_ITERATIONS = 6;
const MAIN_AGENT_TEMPERATURE = 0.7;

const MIN_SPEAKING_MS = 2000;
const SPEAKING_MS_PER_CHARACTER = 70;

export interface AgentOptions {
  // Context from whoever started the conversation, e.g. the question the
  // tidiness coach just asked; the reply arrives as a new conversation.
  extraSystemPrompt?: string;
  // No tool schema at all: for turns that must never act.
  withholdTools?: boolean;
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

function speakingDurationMs(content: string): number {
  return Math.max(MIN_SPEAKING_MS, content.length * SPEAKING_MS_PER_CHARACTER);
}

export async function runAgent(
  userMessage: string,
  conversationId: string,
  log: FastifyBaseLogger,
  options: AgentOptions = {},
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
    outcome = await runToolCallingLoop(messages, target, conversationId, userMessage, log, options.withholdTools ?? false);
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
  const lastAssistantMessage = [...existing.messages].reverse().find(m => m.role === "assistant")?.content ?? "";
  const lastUserMessage = [...existing.messages].reverse().find(m => m.role === "user")?.content ?? "";
  return classifyFollowUp(lastUserMessage, lastAssistantMessage, userMessage, log);
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
  withholdTools: boolean,
): Promise<LoopOutcome> {
  const completedToolCalls = new Set<string>();
  // True once the model repeats itself - see executeToolBatch.
  let forceFinalResponse = withholdTools;

  for (let i = 0; i < MAX_ITERATIONS + 1; i++) {
    if (i === MAX_ITERATIONS && !forceFinalResponse) break;

    log.info({ conversationId, iteration: i + 1, toolsWithheld: forceFinalResponse }, "Calling Ollama");
    const message = await callOllama(messages, target, forceFinalResponse);

    if (message.tool_calls?.length && !forceFinalResponse) {
      const toolCalls = message.tool_calls;
      const outcome = await executeToolBatch(toolCalls, message.content, messages, completedToolCalls, conversationId, log);
      if (outcome === "repeated") forceFinalResponse = true;
      continue;
    }

    return { kind: "answered", rawContent: message.content, toolsWereWithheld: forceFinalResponse };
  }

  log.warn({ conversationId, userMessage, model: target.model, maxIterations: MAX_ITERATIONS }, "Max tool-call iterations exhausted without a final response");
  return { kind: "exhausted" };
}

function callOllama(messages: Message[], target: OllamaTargetConfig, forceFinalResponse: boolean): Promise<Message> {
  return ollamaChat(target.baseUrl, {
    model: target.model,
    messages,
    ...(forceFinalResponse ? {} : { tools }),
    ...(target.think !== undefined && { think: target.think }),
    ...(target.keepAlive !== undefined && { keep_alive: target.keepAlive }),
    options: { temperature: MAIN_AGENT_TEMPERATURE, num_predict: RESPONSE_RESERVE_TOKENS, num_ctx: target.numCtx },
  });
}

// Executes one batch of tool calls. Only catches an exact repeat of the WHOLE
// previous batch (the model stuck in a loop) - a mixed batch of new and
// already-run calls still re-executes both; that's the separate "duplicate
// tool-call detection" ticket (CtjMmdnP), not this refactor's job.
async function executeToolBatch(
  toolCalls: OllamaToolCall[],
  assistantContent: string,
  messages: Message[],
  completedToolCalls: Set<string>,
  conversationId: string,
  log: FastifyBaseLogger,
): Promise<ToolBatchOutcome> {
  const callKeys = toolCalls.map(t => `${t.function.name}:${JSON.stringify(t.function.arguments)}`);
  const wholeBatchAlreadyRan = callKeys.every(k => completedToolCalls.has(k));
  if (wholeBatchAlreadyRan) {
    log.warn({ conversationId, tools: callKeys }, "Duplicate tool calls detected, retrying with tools withheld");
    return "repeated";
  }
  callKeys.forEach(k => completedToolCalls.add(k));

  log.info(
    { conversationId, tools: toolCalls.map(t => `${t.function.name}(${JSON.stringify(t.function.arguments)})`) },
    "Tool calls requested",
  );

  messages.push({ role: "assistant", content: assistantContent, tool_calls: toolCalls });

  for (const call of toolCalls) {
    const result = await executeTool(call.function.name, call.function.arguments, log, conversationId);
    messages.push({ role: "tool", content: result, tool_call_id: call.id });
  }

  return "executed";
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
