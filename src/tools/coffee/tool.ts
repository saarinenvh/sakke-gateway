import type { Tool } from "../types.js";
import { recordCoffeeAnswer } from "../../features/morning/coffee.js";
import { toolParameters, parseToolArgs } from "../parameters.js";
import { coffeeArgsSchema } from "./schema.js";

export const coffeeTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "coffee",
      description: "Record whether the coffee maker is loaded for the morning. At the alarm, a loaded coffee maker is started; otherwise it's left off. After you asked at good night, or whenever they say it: 'yes', 'I loaded it', 'it's ready' -> set_loaded with loaded true. 'No', 'I didn't', 'forgot' -> set_loaded with loaded false.",
      parameters: toolParameters(coffeeArgsSchema),
    },
  },
  repeatable: () => false,
  execute: async args => {
    const { loaded } = parseToolArgs(coffeeArgsSchema, args, "coffee");
    const result = await recordCoffeeAnswer(loaded, Date.now());
    if (result.kind === "unavailable") return "Couldn't record it: the gateway database isn't available right now.";
    return loaded
      ? "Recorded: the coffee maker is loaded. It starts with the morning alarm."
      : "Recorded: the coffee maker isn't loaded. It stays off in the morning.";
  },
};
