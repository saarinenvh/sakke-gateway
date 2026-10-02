import { callService } from "./client.js";

// The Companion app speaks a notification whose message is "TTS". Without high
// priority and a zero time-to-live, Android holds it until the phone is unlocked.
const SPOKEN_NOTIFICATION = {
  message: "TTS",
  mediaStream: "alarm_stream",
  priority: "high",
  ttlSeconds: 0,
} as const;

export function buildSpokenNotification(text: string): Record<string, unknown> {
  return {
    message: SPOKEN_NOTIFICATION.message,
    data: {
      tts_text: text,
      media_stream: SPOKEN_NOTIFICATION.mediaStream,
      priority: SPOKEN_NOTIFICATION.priority,
      ttl: SPOKEN_NOTIFICATION.ttlSeconds,
    },
  };
}

// notifyService is the phone's service without the domain, e.g. "mobile_app_pixel".
export async function speakOnPhone(notifyService: string, text: string): Promise<void> {
  await callService("notify", notifyService, buildSpokenNotification(text));
}
