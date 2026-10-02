import { z } from "zod";
import type { Tool } from "../types.js";
import { parseOrThrow } from "../../util/validation.js";
import { recordCoffeeAnswer } from "../../features/morning/coffee.js";

const COFFEE_ACTIONS = ["set_loaded"] as const;

const coffeeArgsSchema = z.object({
  action: z.enum(COFFEE_ACTIONS),
  loaded: z.boolean(),
});

export const coffeeTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "coffee",
      description: "Record whether the coffee maker is loaded for the morning. At the alarm, a loaded coffee maker is started; otherwise it's left off. After you asked at good night, or whenever they say it: 'yes', 'I loaded it', 'it's ready' -> set_loaded with loaded true. 'No', 'I didn't', 'forgot' -> set_loaded with loaded false.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...COFFEE_ACTIONS] },
          loaded: { type: "boolean", description: "Whether the coffee maker is loaded with water and coffee." },
        },
        required: ["action", "loaded"],
      },
    },
  },
  repeatable: () => false,
  execute: async args => {
    const { loaded } = parseOrThrow(coffeeArgsSchema, args, "coffee tool arguments");
    const result = await recordCoffeeAnswer(loaded, Date.now());
    if (result.kind === "unavailable") return "Couldn't record it: the gateway database isn't available right now.";
    return loaded
      ? "Recorded: the coffee maker is loaded. It starts with the morning alarm."
      : "Recorded: the coffee maker isn't loaded. It stays off in the morning.";
  },
};
