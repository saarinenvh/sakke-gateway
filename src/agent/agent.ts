import type { FastifyBaseLogger } from "fastify";
import { tools, executeTool } from "../tools/registry.js";
import { buildSystemPrompt, refreshClock } from "./systemPrompt.js";
import { broadcastState } from "../display/displayState.js";
import { classifyFollowUp } from "./continuationCheck.js";
import { cleanForSpeech } from "./voiceText.js";
import { getOllamaTarget } from "./ollamaRouter.js";
import {
  type Message,
  type OllamaToolCall,
  getConversation,
  saveConversation,
  clearAwaitingContinuation,
  dropConversation,
  pruneStale,
  trimConversationHistory,
  isChatModeRequest,
  isResetRequest,
} from "./conversationStore.js";

const MAX_ITERATIONS = 6;

export async function runAgent(
  userMessage: string,
  conversationId: string,
  log: FastifyBaseLogger,
): Promise<{ content: string; continueConversation: boolean }> {
  pruneStale();

  if (isResetRequest(userMessage)) {
    dropConversation(conversationId);
    log.info({ conversationId, userMessage }, "Conversation reset");
    const reply = "Fine. Wiped. We never spoke.";
    broadcastState("speaking", Math.max(2000, reply.length * 70));
    return { content: reply, continueConversation: false };
  }

  let existing = getConversation(conversationId);

  if (existing?.awaitingContinuation && !existing.chatMode) {
    const lastAssistantMessage = [...existing.messages].reverse().find(m => m.role === "assistant")?.content ?? "";
    const lastUserMessage = [...existing.messages].reverse().find(m => m.role === "user")?.content ?? "";
    const verdict = await classifyFollowUp(lastUserMessage, lastAssistantMessage, userMessage, log);

    if (verdict === "noise") {
      log.info({ conversationId, userMessage }, "Utterance deemed noise, staying silent");
      clearAwaitingContinuation(conversationId);
      broadcastState("idle");
      return { content: "", continueConversation: false };
    }

    if (verdict === "new_request") {
      // A real request, just off-topic vs. the last exchange - respond to it
      // fresh instead of dragging in irrelevant prior context (or, worse,
      // silencing it the way "noise" does).
      log.info({ conversationId, userMessage }, "New unrelated request detected, starting fresh conversation");
      dropConversation(conversationId);
      existing = undefined;
    }
  }

  // Built on a COPY of the stored history, and only committed back to the map
  // once a response has actually been produced. This used to be
  // `existing?.messages ?? [...]` - i.e. the very same array object held in the
  // map - so every push below mutated stored history immediately, before
  // anything had succeeded. A thrown Ollama call then left a dangling user
  // message (plus any completed assistant/tool pairs) permanently in the
  // conversation, and the next turn resumed from that corrupt state, feeding
  // the model a history of consecutive unanswered user messages. The
  // MAX_ITERATIONS path had the mirror problem: it never called
  // conversations.set at all, so a brand-new conversation's turn was dropped.
  // Copying the array is enough - the message objects themselves are never
  // mutated in place, only appended.
  const messages: Message[] = existing
    ? [...existing.messages]
    : [{ role: "system", content: await buildSystemPrompt() }];
  if (existing && messages[0]?.role === "system") {
    messages[0] = { ...messages[0], content: refreshClock(messages[0].content) };
  }

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
  // Set when the model starts repeating itself - the next pass withholds the
  // tool schema entirely so it has to answer from the results already in
  // context. See the duplicate-detection branch below.
  let forceFinalResponse = false;

  // MAX_ITERATIONS tool-calling passes, plus one reserved slot that is only
  // ever used for the forced tools-withheld pass - that one isn't the model
  // looping, it's us telling it to stop, so it shouldn't consume the budget.
  try {
    for (let i = 0; i < MAX_ITERATIONS + 1; i++) {
      if (i === MAX_ITERATIONS && !forceFinalResponse) break;

      log.info({ conversationId, iteration: i + 1, toolsWithheld: forceFinalResponse }, "Calling Ollama");

      const res = await fetch(`${target.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: target.model,
          messages,
          ...(forceFinalResponse ? {} : { tools }),
          stream: false,
          ...(target.think !== undefined && { think: target.think }),
          ...(target.keepAlive !== undefined && { keep_alive: target.keepAlive }),
          options: { temperature: 0.7, num_predict: 2000, num_ctx: target.numCtx },
        }),
      });

      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);

      const json = await res.json() as { message: Message & { tool_calls?: OllamaToolCall[] } };
      const message = json.message;

      if (message.tool_calls?.length && !forceFinalResponse) {
        // Detect repeated identical tool calls — model is stuck in a loop
        const callKeys = message.tool_calls.map(t => `${t.function.name}:${JSON.stringify(t.function.arguments)}`);
        const alreadyDone = callKeys.every(k => completedToolCalls.has(k));
        if (alreadyDone) {
          // This used to `break`, which fell straight through into the
          // max-iterations path below - so the user heard "I got confused trying
          // to answer that." even though the tool had already run successfully,
          // and the log claimed a response was being forced when nothing forced
          // one. Withhold the tool schema for one more pass instead, so the model
          // has no option but to answer from the tool results already in context.
          log.warn({ conversationId, tools: callKeys }, "Duplicate tool calls detected, retrying with tools withheld");
          forceFinalResponse = true;
          continue;
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

      const content = cleanForSpeech(message.content, forceFinalResponse);

      messages.push({ role: "assistant", content });
      saveConversation(conversationId, { messages, chatMode, awaitingContinuation: true });

      const asksQuestion = content.trimEnd().endsWith("?");
      log.info({ conversationId, model: target.model, turns: messages.length - 1, response: content, chatMode, asksQuestion }, "Agent response");
      const speakingMs = Math.max(2000, content.length * 70);
      broadcastState("speaking", speakingMs);
      return { content, continueConversation: true };
    }
  } catch (err) {
    // "thinking" was broadcast before the loop, and only the speaking/idle
    // calls ever clear it (the speaking one schedules the auto-idle timer). A
    // throw from here used to leave the tablet display spinning on "thinking"
    // indefinitely, with nothing to reset it until the next successful turn.
    broadcastState("idle");
    throw err;
  }

  log.warn({ conversationId, userMessage, model: target.model, maxIterations: MAX_ITERATIONS }, "Max tool-call iterations exhausted without a final response");
  broadcastState("idle");
  return { content: "I got confused trying to answer that.", continueConversation: chatMode };
}
