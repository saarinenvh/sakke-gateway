import type { FastifyBaseLogger } from "fastify";

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const model = process.env.OLLAMA_MODEL ?? "qwen3:8b";

export async function isRelevantContinuation(
  lastAssistantMessage: string,
  newUtterance: string,
  log: FastifyBaseLogger,
): Promise<boolean> {
  const prompt = `Here is the most recent exchange between a voice assistant and a user:
Assistant said: "${lastAssistantMessage}"
New speech picked up by the microphone: "${newUtterance}"

Is this new speech the user continuing the conversation with the assistant, or something unrelated (talking to someone else, background noise, an unrelated comment)? Answer with exactly one word: continuation or unrelated.`;

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
      log.warn({ status: res.status }, "⚠️  Continuation check HTTP error, defaulting to not-continuation");
      return false;
    }

    const json = await res.json() as { message: { content: string } };
    const verdict = json.message.content
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim()
      .toLowerCase();
    const isContinuation = verdict.includes("continuation");

    // TEMP: info level to observe real-world verdicts during tuning; demote to log.debug once validated.
    log.info({ lastAssistantMessage, newUtterance, verdict, isContinuation }, "🧭 Continuation relevance check");

    return isContinuation;
  } catch (err: any) {
    log.warn({ err: err.message }, "⚠️  Continuation check failed, defaulting to not-continuation");
    return false;
  }
}
