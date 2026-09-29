// What a kind of model request is allowed to do. The inference scheduler
// (docs/roadmap/inference-scheduler in sakke-workspace) grows these into full
// request profiles; for now a profile is its tool allowlist. A tool that is
// registered but not listed here can't be offered to or called by the model.
export interface InferenceProfile {
  tools: readonly string[];
}

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
    ],
  },
  // Sakke announcing a timer, reminder or scheduled action. Never acts.
  announcement: {
    tools: [],
  },
  // The tidiness coach asking whether to clean. Never acts.
  tidiness_nag: {
    tools: [],
  },
} as const satisfies Record<string, InferenceProfile>;

export type InferenceProfileName = keyof typeof INFERENCE_PROFILES;
