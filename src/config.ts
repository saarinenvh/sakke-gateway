// All configuration, read and validated once, in one place.
//
// Before this, ~43 `process.env.X ?? "default"` expressions were scattered
// across 13 modules and evaluated at import time. That had three problems, all
// of which bit for real:
//
//   - Nothing validated anything, and nothing was loud about a bad value. A
//     missing OLLAMA_CLASSIFIER_BASE_URL silently muted every follow-up, and a
//     blank WEATHER_LAT silently skipped a default that had been correct for
//     months (docker-compose substitutes an unset variable as "", and
//     `"" ?? fallback` is "").
//   - The defaults assumed a laptop - "localhost" for both Ollama and Home
//     Assistant - which cannot work inside this container.
//   - Capturing values into module-level consts at import time makes the
//     modules untestable without resetting the module registry.
//
// So: read env only here, expose a plain object, and have consumers read
// `config.ha.baseUrl` INSIDE their functions rather than destructuring it into
// a module-level const. That last part is what makes a test able to change a
// value between cases without any module-reset machinery.

// Blank is not the same as unset - see the note above about docker-compose.
function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}

function num(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// true / false, or undefined to let the model decide. Must match what the model
// actually supports: an "instruct" build rejects any request carrying `think`,
// with a 400 on every tool call.
function bool(name: string): boolean | undefined {
  const raw = env(name);
  return raw === "true" ? true : raw === "false" ? false : undefined;
}

export interface OllamaTargetConfig {
  baseUrl: string;
  model: string;
  numCtx: number;
  think: boolean | undefined;
  keepAlive: string | undefined;
}

export interface Config {
  port: number;
  timezone: string;
  stateDir: string;
  wikiRoot: string;
  ollama: {
    server: OllamaTargetConfig;
    // Null unless PC_OLLAMA_BASE_URL is set, in which case routing falls back
    // to the server exactly as it did before GPU routing existed.
    pc: OllamaTargetConfig | null;
    // Deliberately independent of the main agent's model so classification
    // stays fast even when the agent is routed to something bigger.
    classifier: { baseUrl: string; model: string };
  };
  ha: {
    baseUrl: string;
    token: string;
    satelliteEntityId: string;
    tasksTodo: string;
    calendarEntities: string[];
  };
  // How long to wait after waking the living room TV before sending it an app
  // to launch. Five seconds was tuned against one particular TV; it is
  // configuration, not a constant, and tests set it to zero.
  tvWakeMs: number;
  spotify: { clientId: string; clientSecret: string };
  openai: { apiKey: string; lightingModel: string };
  search: { searxngUrl: string };
  weather: { lat: string; lon: string };
  // Anything missing or implausible, collected rather than thrown. index.ts
  // logs these at startup. Deliberately not fatal: this service already starts
  // with a dead Home Assistant on purpose, and a home assistant that refuses to
  // boot over a missing Spotify key would be worse than one that says so and
  // carries on.
  problems: string[];
}

function loadConfig(): Config {
  const problems: string[] = [];

  const require = (name: string, why: string): string => {
    const value = env(name);
    if (value === undefined) problems.push(`${name} is not set - ${why}`);
    return value ?? "";
  };

  const serverTarget: OllamaTargetConfig = {
    baseUrl: env("OLLAMA_BASE_URL") ?? "http://host.docker.internal:11434",
    model: env("OLLAMA_MODEL") ?? "qwen3:8b",
    // Without an explicit num_ctx Ollama's default window is small enough that
    // the system prompt plus the tool schema gets silently truncated, which
    // produces hallucinated, tool-call-free responses.
    numCtx: num("OLLAMA_NUM_CTX", 32768),
    think: bool("OLLAMA_THINK"),
    // Unset by default: the server is dedicated to Sakke, so there's no reason
    // to be eager about freeing its VRAM the way the PC target is.
    keepAlive: env("OLLAMA_KEEP_ALIVE"),
  };

  const pcBaseUrl = env("PC_OLLAMA_BASE_URL");
  const pcTarget: OllamaTargetConfig | null = pcBaseUrl
    ? {
        baseUrl: pcBaseUrl,
        model: env("PC_OLLAMA_MODEL") ?? serverTarget.model,
        numCtx: num("PC_OLLAMA_NUM_CTX", 32768),
        think: bool("PC_OLLAMA_THINK"),
        // Also unset by default - a short keep-alive here would force a cold
        // reload on every PC-routed request, including consecutive ones seconds
        // apart. VRAM is freed proactively by status-service.ps1 on the PC
        // instead, at the moment it detects the GPU going busy.
        keepAlive: env("PC_OLLAMA_KEEP_ALIVE"),
      }
    : null;

  const classifierBaseUrl = env("OLLAMA_CLASSIFIER_BASE_URL");
  if (classifierBaseUrl === undefined) {
    problems.push(
      "OLLAMA_CLASSIFIER_BASE_URL is not set - falling back to the default. " +
      "If it is wrong, Sakke stops answering follow-ups entirely and fails quiet by design",
    );
  }

  return {
    port: num("PORT", 3100),
    timezone: env("TZ") ?? "Europe/Helsinki",
    stateDir: env("STATE_DIR") ?? "/data",
    wikiRoot: env("WIKI_ROOT") ?? "/wiki",
    ollama: {
      server: serverTarget,
      pc: pcTarget,
      classifier: {
        baseUrl: classifierBaseUrl ?? "http://host.docker.internal:11434",
        model: env("OLLAMA_CLASSIFIER_MODEL") ?? "qwen3:4b-instruct-2507-q8_0",
      },
    },
    ha: {
      baseUrl: env("HA_BASE_URL") ?? "http://host.docker.internal:8123",
      token: require("HA_TOKEN", "every Home Assistant call will be rejected"),
      satelliteEntityId: env("ASSIST_SATELLITE_ENTITY_ID") ?? "assist_satellite.home_assistant_voice",
      tasksTodo: env("TASKS_TODO") ?? "todo.sakke_tasks",
      calendarEntities: (env("CALENDAR_ENTITIES") ?? "").split(",").map(s => s.trim()).filter(Boolean),
    },
    tvWakeMs: num("TV_WAKE_MS", 5000),
    spotify: {
      clientId: env("SPOTIFY_CLIENT_ID") ?? "",
      clientSecret: env("SPOTIFY_CLIENT_SECRET") ?? "",
    },
    openai: {
      apiKey: env("OPENAI_API_KEY") ?? "",
      lightingModel: env("OPENAI_LIGHTING_MODEL") ?? "gpt-4o",
    },
    search: { searxngUrl: env("SEARXNG_URL") ?? "http://searxng:8080" },
    weather: {
      lat: env("WEATHER_LAT") ?? "60.1583",
      lon: env("WEATHER_LON") ?? "24.7339",
    },
    problems,
  };
}

export const config: Config = loadConfig();

// Re-reads process.env in place, keeping the same object identity so modules
// holding a reference see the new values. For tests.
export function reloadConfig(): void {
  Object.assign(config, loadConfig());
}
