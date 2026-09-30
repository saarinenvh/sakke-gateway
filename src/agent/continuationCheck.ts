import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { ollamaChat, OllamaError } from "../integrations/ollama/client.js";
import { ValidationError } from "../util/validation.js";

// Deliberately independent of OLLAMA_BASE_URL/OLLAMA_MODEL (the main agent's
// config) rather than falling back to them - once GPU routing sends the main
// agent to the PC's bigger model, this classification step (continuation vs
// new_request vs noise) still runs on every single follow-up utterance and
// doesn't need that model's reasoning power. Sharing the main model's config
// would mean paying its full latency just to classify, on every turn.
// Always local, always the fast model, independent of whatever the main
// agent routes to.
// Defaults assume the container, not a laptop: this service runs in Docker
// without network_mode host, so "localhost" here is the container itself and
// nothing is listening on it. The previous localhost default could not work in
// any real deployment, and its failure mode is invisible (see below), so a
// missing OLLAMA_CLASSIFIER_BASE_URL silently muted every follow-up.

export type FollowUpVerdict = "continuation" | "new_request" | "noise";

// Utterances picked up during the no-wake-word follow-up window (after any
// response, continue_conversation stays open for a while) need 3-way
// classification, not 2-way - collapsing "off-topic but a real request" and
// "not directed at Sakke at all" into a single "unrelated" bucket meant a
// genuine new request got silenced the same as background chatter. Silence
// is still the fail-closed default for anything ambiguous or noise-like -
// staying quiet is recoverable (just repeat yourself), responding to speech
// never meant for Sakke is not.
export async function classifyFollowUp(
  lastUserMessage: string,
  lastAssistantMessage: string,
  newUtterance: string,
  log: FastifyBaseLogger,
): Promise<FollowUpVerdict> {
  // The user's last message supplies the topic to compare against; the
  // assistant's line alone lets an open-ended reply "continue" into anything.
  // Addressee is decided before topic: judged by topic first, the model
  // treated any on-topic chatter or fragment as continuation.
  const prompt = `Here is the most recent exchange between a voice assistant and a user:
User said: "${lastUserMessage}"
Assistant replied: "${lastAssistantMessage}"
New speech picked up by the microphone: "${newUtterance}"

The microphone also picks up speech that is not meant for the assistant. Decide in this order:

1. Is the new speech meant for the assistant? Only if it is a complete request or question for the assistant, or it answers, confirms, picks from, corrects or adjusts what the assistant just said or did, or tells the assistant something it needs to know about that. Otherwise it is noise: talking to someone else, one side of a phone call, background chatter, a reaction or remark that asks the assistant for nothing (even on the same topic), a hesitation sound, an incomplete fragment, or "okay"/"yeah" when the assistant asked nothing.
2. If it is meant for the assistant: continuation if it is about the same specific topic or task as the exchange above, new_request if it is a different topic. A generic, open-ended assistant reply (e.g. "what can I do for you?", "still here") does not make the next thing continuation - a different topic is still new_request.

If unsure whether it is meant for the assistant, answer noise.

Also rate how complex the new speech would be for the assistant to handle, from 0 to 100: 0 is a trivial one-step command (turn on a light), 100 needs multi-step reasoning or planning.

Answer in exactly this form: <category> <complexity>, for example: continuation 20`;

  const { baseUrl, model, numCtx } = config.ollama.classifier;

  try {
    const message = await ollamaChat(
      baseUrl,
      {
        model,
        messages: [{ role: "user", content: prompt }],
        think: false,
        options: { temperature: 0.1, num_predict: 10, num_ctx: numCtx },
      },
      log,
    );

    const raw = message.content
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim()
      .toLowerCase();

    // Fail-closed: anything that isn't a clear continuation or a clear new
    // request is treated as noise, including unparseable model output.
    const verdict: FollowUpVerdict = raw.includes("new_request") || raw.includes("new request")
      ? "new_request"
      : raw.includes("continuation")
      ? "continuation"
      : "noise";

    // Spike: logged only, nothing routes on it yet (Trello vfQtPvsD).
    const complexity = parseComplexity(raw);

    // TEMP: info level to observe real-world verdicts during tuning; demote to log.debug once validated.
    log.info({ model, lastUserMessage, lastAssistantMessage, newUtterance, raw, verdict, complexity }, "Follow-up classification");

    return verdict;
  } catch (err) {
    // Deliberately still "noise" rather than "new_request": responding to
    // speech that was never aimed at Sakke is the worse failure, and staying
    // quiet is recoverable by repeating the wake word. But an unreachable
    // classifier is an outage, not an ambiguous utterance - it silences every
    // follow-up for as long as it lasts, so it gets logged as an error rather
    // than a warning that blends into the noise.
    if (err instanceof OllamaError) {
      log.error({ model, baseUrl, status: err.status, err: err.message }, "Continuation check HTTP error - follow-ups will be ignored until this is fixed");
    } else if (err instanceof ValidationError) {
      log.error({ model, baseUrl, err: err.message }, "Continuation check got an invalid response - follow-ups will be ignored until this is fixed");
    } else {
      log.error(
        { model, baseUrl, err: err instanceof Error ? err.message : String(err) },
        "Continuation check unreachable - follow-ups will be ignored until this is fixed",
      );
    }
    return "noise";
  }
}

const MAX_COMPLEXITY = 100;

// Undefined rather than a guess when the model gives no usable number.
function parseComplexity(raw: string): number | undefined {
  const match = raw.match(/\b(\d{1,3})\b/);
  if (!match) return undefined;
  const complexity = Number(match[1]);
  return complexity <= MAX_COMPLEXITY ? complexity : undefined;
}
