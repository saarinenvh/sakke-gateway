import type { FastifyBaseLogger } from "fastify";

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const model = process.env.OLLAMA_MODEL ?? "qwen3:8b";

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
  lastAssistantMessage: string,
  newUtterance: string,
  log: FastifyBaseLogger,
): Promise<FollowUpVerdict> {
  const prompt = `Here is the most recent exchange between a voice assistant and a user:
Assistant said: "${lastAssistantMessage}"
New speech picked up by the microphone: "${newUtterance}"

Classify the new speech into exactly one of these three categories:
- continuation: directly continues, answers, corrects, or responds to what the assistant just said (e.g. picking an option, confirming, correcting a detail).
- new_request: a clear, coherent new request or comment, clearly directed at the assistant, just unrelated to the previous topic.
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
      log.warn({ model, status: res.status }, "Continuation check HTTP error, defaulting to noise");
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
    log.info({ model, lastAssistantMessage, newUtterance, raw, verdict }, "Follow-up classification");

    return verdict;
  } catch (err: any) {
    log.warn({ model, err: err.message }, "Continuation check failed, defaulting to noise");
    return "noise";
  }
}
