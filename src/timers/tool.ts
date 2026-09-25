import type { Tool } from "../tools/types.js";
import { setTimer, cancelTimer, listTimers } from "./timers.js";

export const timerTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "timer",
      description: "Set, cancel, or list voice timers. When a timer finishes, the assistant will announce it aloud with full personality. Use for 'remind me in X minutes', 'set a timer for Y', 'wake me up in Z minutes'.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["set", "cancel", "list"] },
          duration_minutes: { type: "number", description: "Duration in minutes for the 'set' action" },
          label: { type: "string", description: "What the timer is for, e.g. 'food in the oven', 'meditation'. Used in the announcement when the timer finishes." },
          timer_id: { type: "string", description: "Timer ID to cancel (from 'list' action). If omitted for cancel, cancels the only active timer or asks which one." },
        },
        required: ["action"],
      },
    },
  },
  execute: args => {
    const { action, duration_minutes, label, timer_id } = args as {
      action: string;
      duration_minutes?: number;
      label?: string;
      timer_id?: string;
    };

    if (action === "set") {
      if (!duration_minutes || duration_minutes <= 0) return "Duration is required to set a timer.";
      const mins = Math.round(duration_minutes);
      const timerLabel = label ?? "timer";
      // The id is what `timer cancel` and `timer list` identify a timer by, and
      // it used to be discarded here - so it was never something the user could
      // have known.
      const timerId = setTimer(mins * 60 * 1000, timerLabel);
      const human = mins === 1 ? "1 minute" : `${mins} minutes`;
      return `Timer set for ${human}. Label: ${timerLabel}. ID: ${timerId}.`;
    }

    if (action === "cancel") {
      const active = listTimers();
      if (active.length === 0) return "No active timers.";
      const key = timer_id ?? (active.length === 1 ? active[0].id : "");
      if (!key) {
        return `Multiple timers active: ${active.map(t => `${t.id} (${t.label})`).join(", ")}. Specify a timer ID to cancel.`;
      }
      const cancelled = cancelTimer(key);
      return cancelled ? `Cancelled timer: ${cancelled}.` : "Timer not found.";
    }

    if (action === "list") {
      const active = listTimers();
      if (active.length === 0) return "No active timers.";
      return active.map(t => {
        const remaining = Math.max(0, Math.round(t.remainingMs / 1000 / 60));
        return `${t.id}: "${t.label}" — ${remaining} minute${remaining !== 1 ? "s" : ""} remaining`;
      }).join("\n");
    }

    return `Unknown timer action: ${action}`;
  },
};
