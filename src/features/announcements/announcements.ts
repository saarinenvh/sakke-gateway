import type { FastifyBaseLogger } from "fastify";
import { config } from "../../config.js";
import { callService } from "../../integrations/homeAssistant/client.js";
import { showSpeakingWhile } from "../display/display.js";
import { withTimeout } from "../../util/async.js";
import { writeText } from "../../inference/writeText.js";
import { moduleLog } from "../../logger.js";

// How Sakke would say a message, in its own voice.
export type WordingWriter = (message: string) => Promise<string>;

// A due announcement never waits long for its wording; past this, the message
// is spoken as it is.
export const WORDING_TIMEOUT_MS = 10_000;

// Longer than the default request timeout: the satellite has to actually
// speak the line before Home Assistant answers.
const SATELLITE_ANNOUNCE_TIMEOUT_MS = 15_000;

export type WordingSource = "generated" | "fallback";

export interface Announcement {
  spoken: string;
  wording: WordingSource;
}

// Not "tell the owner": the model took "owner" as a form of address and began
// with "Owner, ...".
export function announcementRequest(message: string): string {
  return `Say this out loud now, in your own words and briefly: ${message}`;
}

const writeAnnouncementWording: WordingWriter = message =>
  writeText("announcement", announcementRequest(message), moduleLog());

let writeWording: WordingWriter = writeAnnouncementWording;

// Tests replace the wording writer; the gateway uses the real one.
export function setWordingWriter(writer: WordingWriter): void {
  writeWording = writer;
}

// Speaks a message on the voice satellite. The wording is best effort; the
// speaking is not, so a failure to reach the satellite throws.
export async function announce(message: string, log: FastifyBaseLogger): Promise<Announcement> {
  const announcement = await prepareAnnouncement(message, log);
  log.info({ message, spoken: announcement.spoken, wording: announcement.wording }, "Announcing");
  await speakOnSatellite(announcement.spoken);
  return announcement;
}

async function prepareAnnouncement(message: string, log: FastifyBaseLogger): Promise<Announcement> {
  try {
    const spoken = (await withTimeout(writeWording(message), WORDING_TIMEOUT_MS, "wording")).trim();
    if (spoken) return { spoken, wording: "generated" };
    log.warn({ message }, "Announcement wording came back empty, speaking the message as it is");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.warn({ message, err: reason }, "Announcement wording failed, speaking the message as it is");
  }
  return { spoken: message, wording: "fallback" };
}

// Speaks text that is already worded, as it is.
export async function speakOnSatellite(text: string): Promise<void> {
  await showSpeakingWhile(text, () => callService(
    "assist_satellite",
    "announce",
    { entity_id: config.ha.satelliteEntityId, message: text },
    { timeoutMs: SATELLITE_ANNOUNCE_TIMEOUT_MS },
  ));
}
