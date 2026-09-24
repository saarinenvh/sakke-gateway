import type { FastifyBaseLogger } from "fastify";
import { env } from "../env.js";

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
const baseUrl = env("OLLAMA_CLASSIFIER_BASE_URL") ?? "http://host.docker.internal:11434";
const model = env("OLLAMA_CLASSIFIER_MODEL") ?? "qwen3:4b-instruct-2507-q8_0";

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
  // Passing only the assistant's last line let a generic, open-ended reply
  // (e.g. "What can I do for you?") trivially "continue" into literally
  // anything - a genuine topic switch (Spotify chat -> "light the campfire")
  // got classified continuation just because it technically answered an
  // open question, dragging irrelevant history into an unrelated request.
  // Including the user's last message gives the classifier the actual topic
  // to compare against, not just whatever the assistant happened to ask.
  const prompt = `Here is the most recent exchange between a voice assistant and a user:
User said: "${lastUserMessage}"
Assistant replied: "${lastAssistantMessage}"
New speech picked up by the microphone: "${newUtterance}"

Classify the new speech into exactly one of these three categories:
- continuation: about the SAME specific topic or task as the exchange above (e.g. picking an option, confirming, correcting a detail, directly answering a specific question the assistant asked).
- new_request: a clear, coherent request or comment on a DIFFERENT topic than the exchange above. A generic, open-ended assistant reply (e.g. "what can I do for you?", "still here") does NOT make the next thing continuation by default - if it's a different topic, it's new_request even though it technically answers that open question.
- noise: not actually directed at the assistant at all - talking to someone else, background chatter, an incomplete fragment, or anything ambiguous.

Answer with exactly one word: continuation, new_request, or noise.`;

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        think: false,
        options: { temperature: 0.1, num_predict: 10 },
      }),
    });

    if (!res.ok) {
      log.error({ model, baseUrl, status: res.status }, "Continuation check HTTP error - follow-ups will be ignored until this is fixed");
      return "noise";
    }

    const json = await res.json() as { message: { content: string } };
    const raw = json.message.content
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

    // TEMP: info level to observe real-world verdicts during tuning; demote to log.debug once validated.
    log.info({ model, lastUserMessage, lastAssistantMessage, newUtterance, raw, verdict }, "Follow-up classification");

    return verdict;
  } catch (err: any) {
    // Deliberately still "noise" rather than "new_request": responding to
    // speech that was never aimed at Sakke is the worse failure, and staying
    // quiet is recoverable by repeating the wake word. But an unreachable
    // classifier is an outage, not an ambiguous utterance - it silences every
    // follow-up for as long as it lasts, so it gets logged as an error rather
    // than a warning that blends into the noise.
    log.error({ model, baseUrl, err: err.message }, "Continuation check unreachable - follow-ups will be ignored until this is fixed");
    return "noise";
  }
}
