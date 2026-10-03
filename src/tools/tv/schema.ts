import { z } from "zod";

// Model → gateway: the arguments of an open_tv_app tool call.

export const openTvAppArgsExample = { app: "youtube" };

export const openTvAppArgsSchema = z.object({
  app: z.enum(["netflix", "youtube", "spotify", "dgn"]).describe("The app to open"),
});

// Model → gateway: the arguments of a tv_remote_command tool call.

export const tvRemoteCommandArgsExample = { command: "search" };

export const tvRemoteCommandArgsSchema = z.object({
  command: z.enum(["home", "back", "mute", "search"]).describe("The remote command to send"),
});

// Model → gateway: the arguments of a tv_send_text tool call.

export const tvSendTextArgsExample = { text: "disc golf highlights" };

export const tvSendTextArgsSchema = z.object({
  text: z.string().describe("The text to type"),
});
