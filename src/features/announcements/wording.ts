import { runAgent } from "../../agent/agent.js";
import { moduleLog } from "../../logger.js";
import type { WordingWriter } from "./announcer.js";

// A throwaway conversation id: the announcement is its own exchange and has no
// business appearing in whatever the owner was last talking about.
export const writeAnnouncementWording: WordingWriter = async message => {
  const { content } = await runAgent(
    `Tell the owner this now, out loud, in your own words and briefly: ${message}`,
    `announce-${Date.now()}`,
    moduleLog(),
    { profile: "announcement" },
  );
  return content;
};
