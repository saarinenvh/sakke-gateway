import { z } from "zod";

// Model → gateway: the arguments of a coffee tool call.

export const coffeeArgsExample = { action: "set_loaded", loaded: true };

const COFFEE_ACTIONS = ["set_loaded"] as const;

export const coffeeArgsSchema = z.object({
  action: z.enum(COFFEE_ACTIONS),
  loaded: z.boolean().describe("Whether the coffee maker is loaded with water and coffee."),
});
