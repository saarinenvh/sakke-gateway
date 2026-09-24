export const tools = [
  {
    type: "function",
    function: {
      name: "control_home_assistant",
      description: "Control smart home devices: lights, scenes, media, switches, routines. IMPORTANT: Always use the exact action values from the enum — never use HA service names like light.turn_on or switch.turn_on.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "The action to perform. Use scene_design when the user asks to design, create, or generate a lighting scene from a description.",
            enum: [
              "light_on", "light_off", "light_dim", "light_color",
              "scene_activate", "scene_create", "scene_design",
              "switch_on", "switch_off",
              "media_play", "media_pause", "media_stop", "media_volume",
            ],
          },
          area: { type: "string", description: "Room area id e.g. living_room" },
          device: { type: "string", description: "Specific entity_id" },
          scene: { type: "string", description: "Scene id for scene_activate" },
          scene_name: { type: "string", description: "Name for scene_create (saves current light state as a scene)" },
          scene_description: { type: "string", description: "REQUIRED for scene_design: describe the atmosphere or mood and the AI generates and applies a custom lighting scene. Use this when the user says 'design', 'create a scene for', 'make it look like', 'gaming den', etc." },
          brightness_pct: { type: "number", description: "Brightness percentage, 0-100, for light_dim. \"Dim the lights\" with no number given is about 30." },
          color: { type: "string", description: "Color name for light_color" },
          volume: { type: "number", description: "0-100 for media_volume" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current information, facts, news",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather and forecast for the user's location (Espoo, Finland)",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "spotify",
      description: "Control Spotify playback, or find and play a track/artist/album/playlist by name. Voice input is unreliable for exact names, so there is no direct search-and-blind-play - always use action 'suggest' first for ANY named request (a song, artist, album, or playlist) to present 3 numbered options by voice, e.g. 'Found: 1. X, 2. Y, 3. Z'. When the user picks one (e.g. 'play the second one', 'take the first option', 'the last one'), use action 'play' with ONLY index (1, 2, or 3) - do not repeat the query/type, the server remembers the last suggestions in this conversation. To hear more options, call suggest again with the SAME query/type and offset increased by 3. Exception: if the query exactly matches a known personal playlist name, calling 'suggest' plays it directly instead of returning a list - in that case the tool result will read like 'Playing X.', NOT a numbered list. IMPORTANT: always base your reply on the ACTUAL tool result text you receive, never on what a typical 'suggest' call usually returns - if the result already confirms something is playing, just confirm that in your own words, do not invent a list or ask 'which one?'.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["play", "pause", "next", "previous", "volume", "suggest"],
          },
          query: { type: "string", description: "Search query for suggest, or for play when directly naming a known personal playlist. Omit when picking a previously suggested option by index." },
          type: {
            type: "string",
            enum: ["track", "artist", "playlist", "album"],
            description: "Type of content to search for (defaults to track). Only used with suggest.",
          },
          volume: { type: "number", description: "0-100 for volume action" },
          offset: { type: "number", description: "Pagination offset for suggest only - 0 for first 3 results, 3 for the next 3, etc." },
          index: { type: "number", description: "For 'play' only: which of the 3 most recently suggested options to play (1, 2, or 3). No other parameters needed - the server already knows what was suggested." },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "manage_list",
      description: "Read, add, complete, or remove items from todo and shopping lists",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list_read", "list_add", "list_complete", "list_remove", "list_sort"],
          },
          list: { type: "string", description: "Entity ID of the list, e.g. todo.groceries" },
          items: { type: "array", items: { type: "string" }, description: "Items to add (for list_add)" },
          item: { type: "string", description: "Item name to complete or remove" },
        },
        required: ["action", "list"],
      },
    },
  },
  {
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
  {
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
  {
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
  {
    type: "function",
    function: {
      name: "get_device_state",
      description: "Get the current state and attributes of a Home Assistant entity. Call this BEFORE acting on a device if you are unsure of its current state. Also use when asked about what is on, what is playing, is something on/off, or any question about current device status.",
      parameters: {
        type: "object",
        properties: {
          entity_id: { type: "string", description: "The entity ID to query, e.g. remote.living_room_tv, media_player.bedroom_tv, light.ceiling" },
        },
        required: ["entity_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_routine",
      description: "Run a user-defined routine (HA script). Use this for any named routine the user has created — e.g. 'good night', 'movie time', 'morning lights'. Check available routines in the system prompt.",
      parameters: {
        type: "object",
        properties: {
          script_id: { type: "string", description: "Script ID from the available routines list, e.g. good_night" },
        },
        required: ["script_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_knowledge",
      description: "Save a new knowledge note. Use when the user shares something worth remembering — a fact, preference, experience, or piece of info. Pick a short descriptive filename. The note is saved to sakke-knowledge/ and added to sakke-index automatically. Always format content as: '## Title\\n\\nShort description of the fact or preference.'",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Short descriptive filename without extension, e.g. espoo_disc_golf_courses or prefers_dark_roast_coffee" },
          content: { type: "string", description: "Markdown content for the note. Include a # title, the fact, and any relevant context." },
        },
        required: ["filename", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_context",
      description: "Load a knowledge base page for detailed context about the user or a topic. Only call when the query is clearly about something in the knowledge base. Check available pages in the system prompt.",
      parameters: {
        type: "object",
        properties: {
          page: { type: "string", description: "Page path from the knowledge base index, e.g. user/user_profile or discgolf/context. Strip [[ and ]] from wikilinks." },
        },
        required: ["page"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tasks",
      description: "Get pending items from Google Tasks (todo list). Use ONLY for tasks, chores, or to-dos — things the user needs to DO. NOT for calendar events or appointments.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["today", "tomorrow", "this_week", "next_week"],
            description: "Time period to fetch tasks for. Defaults to today.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "timer",
      description: "Set, cancel, or list voice timers. When a timer finishes, the assistant will announce it aloud with full personality. Use for 'remind me in X minutes', 'set a timer for Y', 'wake me up in Z minutes'.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["set", "cancel", "list"],
          },
          duration_minutes: {
            type: "number",
            description: "Duration in minutes for the 'set' action",
          },
          label: {
            type: "string",
            description: "What the timer is for, e.g. 'food in the oven', 'meditation'. Used in the announcement when the timer finishes.",
          },
          timer_id: {
            type: "string",
            description: "Timer ID to cancel (from 'list' action). If omitted for cancel, cancels the only active timer or asks which one.",
          },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "refresh_home_data",
      description: "Reload the list of areas, lights, switches, scenes, and routines from Home Assistant. Call this when a scene, light, area, or routine the user mentions isn't in your known lists, or when explicitly asked to refresh, update, or reload your knowledge of the smart home (e.g. 'refresh your scenes', 'do you know about the new scene I made', 'update your info'). This data is only loaded at startup otherwise, so it can go stale when things change in Home Assistant.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_gaming_mode",
      description: "Manually override whether the gaming PC's GPU is available for Sakke to use, instead of waiting for automatic detection. Use 'gaming' when the user says things like 'I'm gaming', 'I'm playing a game', 'leave my PC alone', 'stay off my GPU'. Use 'free' when they say the opposite - 'I'm free', 'done gaming', 'you can use my PC again' - which goes back to automatic detection rather than forcing availability.",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["gaming", "free"],
            description: "'gaming' immediately marks the PC's GPU busy so Sakke stops routing there. 'free' clears the override and resumes automatic detection.",
          },
        },
        required: ["mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_calendar",
      description: "Get events from Google Calendar. Use ONLY for calendar events, appointments, meetings, or scheduled events — things happening at a specific time. NOT for tasks or to-dos.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["today", "tomorrow", "this_week", "next_week"],
            description: "Time period to fetch events for. Defaults to today.",
          },
        },
        required: [],
      },
    },
  },
];
