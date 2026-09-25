import type { Tool } from "../tools/types.js";
import { openApp, sendRemoteCommand, sendText } from "./tv.js";

export const openTvAppTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "open_tv_app",
      description: "Open an app on the living room TV. Use when the user asks to open, launch, or switch to Netflix, YouTube, Spotify, or Disc Golf Network on the TV.",
      parameters: {
        type: "object",
        properties: {
          app: { type: "string", enum: ["netflix", "youtube", "spotify", "dgn"], description: "The app to open" },
        },
        required: ["app"],
      },
    },
  },
  execute: args => openApp(args.app as string),
};

export const tvRemoteCommandTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "tv_remote_command",
      description: "Send a remote-control button press to the living room TV. home = close/exit the current app and return to the home screen. back = go back one screen. mute = toggle mute. search = focus the search field in the current app (use tv_send_text right after to type the search query).",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", enum: ["home", "back", "mute", "search"], description: "The remote command to send" },
        },
        required: ["command"],
      },
    },
  },
  execute: args => sendRemoteCommand(args.command as string),
};

export const tvSendTextTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "tv_send_text",
      description: "Type text into whatever input field is currently focused on the living room TV. Typically used right after tv_remote_command with command=search, to type a search query.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The text to type" },
        },
        required: ["text"],
      },
    },
  },
  execute: args => sendText(args.text as string),
};
