// What a kind of model request is allowed to do. The inference scheduler
// (docs/roadmap/inference-scheduler in sakke-workspace) grows these into full
// request profiles. A tool that is registered but not listed here can't be
// offered to or called by the model.
export interface InferenceProfile {
  tools: readonly string[];
  // "gateway": a live conversation - the gateway keeps its history, classifies
  // follow-ups and shows it on the display. "caller": a feature asked for one
  // piece of text and owns what happens to it; nothing is stored and the
  // display isn't touched.
  contextOwner: ContextOwner;
}

export type ContextOwner = "gateway" | "caller";

export const INFERENCE_PROFILES = {
  // Sakke talking with the owner. announce is left out: Sakke already speaks
  // its reply, and announcing is for speech at a scheduled time.
  sakke: {
    tools: [
      "control_home_assistant",
      "web_search",
      "get_weather",
      "spotify",
      "manage_list",
      "open_tv_app",
      "tv_remote_command",
      "tv_send_text",
      "get_device_state",
      "run_routine",
      "create_knowledge",
      "get_context",
      "get_tasks",
      "schedule",
      "refresh_home_data",
      "set_gaming_mode",
      "get_calendar",
      "vacuum",
      "coffee",
    ],
    contextOwner: "gateway",
  },
  // Sakke announcing a timer, reminder or scheduled action. Never acts.
  announcement: {
    tools: [],
    contextOwner: "caller",
  },
  // The tidiness coach asking whether to clean. Never acts.
  tidiness_nag: {
    tools: [],
    contextOwner: "caller",
  },
  // The morning wake-up's spoken good morning on the phone. Never acts.
  morning_greeting: {
    tools: [],
    contextOwner: "caller",
  },
  // The day summary on the satellite once the owner is up. Never acts.
  morning_brief: {
    tools: [],
    contextOwner: "caller",
  },
} as const satisfies Record<string, InferenceProfile>;

export type InferenceProfileName = keyof typeof INFERENCE_PROFILES;

type ProfilesOwnedBy<Owner extends ContextOwner> = {
  [Name in InferenceProfileName]: (typeof INFERENCE_PROFILES)[Name]["contextOwner"] extends Owner ? Name : never;
}[InferenceProfileName];

/** A live conversation: the agent runs it. */
export type ConversationProfileName = ProfilesOwnedBy<"gateway">;
/** One piece of text a feature asks for: writeText writes it. */
export type CallerProfileName = ProfilesOwnedBy<"caller">;
