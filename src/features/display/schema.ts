import { z } from "zod";
import { sakkeStateSchema } from "./displayState.js";

// HA automation → gateway, POST /display/state, when the voice pipeline's state
// changes. The automation is not kept in sakke-workspace.

export const stateChangeExample = {
  state: "listening",
};

export const stateChangeSchema = z.object({ state: sakkeStateSchema });
