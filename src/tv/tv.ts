import { getState, callService } from "../integrations/homeAssistant/client.js";
import { config } from "../config.js";

// One TV, wired to HA's androidtv_remote integration. If a second one ever
// appears this becomes a parameter; until then a named constant beats the same
// string typed out six times.
const TV_REMOTE = "remote.living_room_tv";

// Prefer deep links over bare package names - HA's androidtv_remote docs warn that
// launching by application ID "doesn't work for many apps due to a Google Play Store
// change." No verified deep link is known for dgn, so it's left as a package name and
// may still fail to launch - test and swap in a working deep link if found.
export const APP_PACKAGES: Record<string, string> = {
  netflix: "https://www.netflix.com/title",
  youtube: "https://www.youtube.com",
  spotify: "spotify://",
  dgn: "com.discgolfprotour",
};

export const REMOTE_COMMANDS: Record<string, string> = {
  home: "HOME",
  back: "BACK",
  mute: "MUTE",
  search: "SEARCH",
};

// Ambiguous phrasing here (e.g. "Sent home to the TV") reads as a normal
// English sentence and has confused the model into asking the user to clarify
// their own tool result - use unambiguous, command-specific text.
const CONFIRMATIONS: Record<string, string> = {
  home: "Exited to the TV home screen.",
  back: "Went back on the TV.",
  mute: "Toggled TV mute.",
  search: "Opened search on the TV.",
};

export async function openApp(app: string): Promise<string> {
  const pkg = APP_PACKAGES[app];
  if (!pkg) return `Unknown app: ${app}`;

  // A cold TV drops the activity that arrives with the wake-up, so it has to be
  // woken first and given time to boot. Already on, and that wait is pure delay.
  const state = await getState(TV_REMOTE);
  if (state.state !== "on") {
    await callService("remote", "turn_on", { entity_id: TV_REMOTE });
    await new Promise(r => setTimeout(r, config.tvWakeMs));
  }

  await callService("remote", "turn_on", { entity_id: TV_REMOTE, activity: pkg });
  return `Opened ${app} on the TV.`;
}

export async function sendRemoteCommand(command: string): Promise<string> {
  const keycode = REMOTE_COMMANDS[command];
  if (!keycode) return `Unknown remote command: ${command}`;
  await callService("remote", "send_command", { entity_id: TV_REMOTE, command: keycode });
  return CONFIRMATIONS[command] ?? `TV remote command "${command}" sent.`;
}

export async function sendText(text: string): Promise<string> {
  await callService("remote", "send_command", { entity_id: TV_REMOTE, command: `text:${text}` });
  return `Typed "${text}" on the TV.`;
}
