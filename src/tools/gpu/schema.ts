import { z } from "zod";

// Model → gateway: the arguments of a set_gaming_mode tool call.

export const setGamingModeArgsExample = { mode: "gaming" };

export const setGamingModeArgsSchema = z.object({
  mode: z
    .enum(["gaming", "free"])
    .describe("'gaming' immediately marks the PC's GPU busy so Sakke stops routing there. 'free' clears the override and resumes automatic detection."),
});
