import type { Tool } from "../types.js";
import { toolParameters, parseToolArgs } from "../parameters.js";
import { openTvAppArgsSchema, tvRemoteCommandArgsSchema, tvSendTextArgsSchema } from "./schema.js";
import { openApp, sendRemoteCommand, sendText } from "./tv.js";

export const openTvAppTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "open_tv_app",
      description: "Open an app on the living room TV. Use when the user asks to open, launch, or switch to Netflix, YouTube, Spotify, or Disc Golf Network on the TV.",
      parameters: toolParameters(openTvAppArgsSchema),
    },
  },
  repeatable: () => false,
  execute: args => openApp(parseToolArgs(openTvAppArgsSchema, args, "open_tv_app").app),
};

export const tvRemoteCommandTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "tv_remote_command",
      description: "Send a remote-control button press to the living room TV. home = close/exit the current app and return to the home screen. back = go back one screen. mute = toggle mute. search = focus the search field in the current app (use tv_send_text right after to type the search query).",
      parameters: toolParameters(tvRemoteCommandArgsSchema),
    },
  },
  repeatable: () => false,
  execute: args => sendRemoteCommand(parseToolArgs(tvRemoteCommandArgsSchema, args, "tv_remote_command").command),
};

export const tvSendTextTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "tv_send_text",
      description: "Type text into whatever input field is currently focused on the living room TV. Typically used right after tv_remote_command with command=search, to type a search query.",
      parameters: toolParameters(tvSendTextArgsSchema),
    },
  },
  repeatable: () => false,
  execute: args => sendText(parseToolArgs(tvSendTextArgsSchema, args, "tv_send_text").text),
};
