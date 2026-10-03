import { z } from "zod";

// Model → gateway: the arguments of an announce tool call.

export const announceArgsExample = { message: "take the minced meat out of the fridge" };

// A refine rather than min(1), which would add a minLength to what the model
// is shown.
export const announceArgsSchema = z.object({
  message: z.string().trim().refine(message => message.length > 0, "Must not be blank")
    .describe("What to tell the owner, e.g. 'take the minced meat out of the fridge'."),
});
