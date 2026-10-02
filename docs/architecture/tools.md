# Tools

A tool is something the model can call. How one is built, how calls are run,
and which requests may use which tools.

## The four layers

A tool is split like an HTTP API, one layer per file:

| File | Like | Holds |
| --- | --- | --- |
| `tools/<name>/prompt.ts` (optional) | API usage guide | when the model should use the tool; added to the system prompt |
| `tools/<name>/tool.ts` | the OpenAPI document | name, description, parameters, `repeatable`; points at the executor |
| `tools/<name>/<name>.ts` | the request handler | validates the arguments, calls services, words the result for the model |
| `features/<feature>/` | the service layer | business logic, database access, anything more than one call |

`tools/search/` is the plain case: the executor makes one HTTP request and
formats the results. As soon as a tool needs a database, state, or logic other
code also uses, that part is a service in `features/`, and the executor calls
it. `tools/announce/` is that case: the executor parses `{ message }`, and
`features/announcements/announcer.ts` does the work.

Why: the definition is what the model sees, and changes to it change how the
model behaves; the executor is the boundary where untrusted model output is
validated; the service is plain code that other features and the scheduler can
call without going through the model. Keeping them apart means each can change
without touching the others.

Older tools (`vacuum/`, `lists/`, …) still keep some logic next to the
executor. New tools follow the layers; old ones move when they're changed for
another reason.

## The registry

`tools/registry.ts` is the single list of tools, in the order the model is
shown them. That order is part of the model's behaviour; changing it is not a
free change.

It runs a call two ways:

- `runTool(name, args, log, conversationId)` returns what happened:
  `{ kind: "ok", result }`, `{ kind: "failed", error }` or `{ kind: "unknown" }`.
  It never throws. The scheduler uses it, so it can tell a failure without
  reading text.
- `executeTool(...)` is the same, worded for the model: the result, or
  "`<name>` failed: …", or "Unknown tool: …". The agent loop uses it.

It is also the only place that logs a call and previews its result.

`repeatable(args)` on each tool says whether the same call with the same
arguments may run twice in one turn: true for reads, false for anything with a
side effect. The agent loop skips a repeat of a non-repeatable call and tells
the model it already ran.

`schedulable(args)` says whether the scheduler may run the call later, with
nobody there to see it. It's optional and missing means no, so a tool has to
opt in; today only `announce` does. The scheduler checks it when a job is set,
and the registry's `runScheduledCall` checks it again when the job runs.

## Request profiles

A profile says what one kind of request may do: which tools it gets, and who
owns its context. They live in `inference/profiles.ts`. The inference scheduler (see
sakke-workspace's `docs/roadmap/inference-scheduler/`) will add priority,
classification and model limits to the same profiles.

| Profile | Used by | Tools | Context owner |
| --- | --- | --- | --- |
| `sakke` | conversations (`/v1/chat/completions`) | every tool except `announce` | gateway |
| `announcement` | wording an announcement | none | caller |
| `tidiness_nag` | the tidiness coach's question | none | caller |
| `morning_greeting` | the morning wake-up's good morning on the phone | none | caller |
| `morning_brief` | the day summary on the satellite | none | caller |

- **Named after the caller or the act**, not the kind of work. The bot's
  profiles will be named the same way (e.g. `telegram`, `sakariheitaja`) when it
  moves onto the scheduler.
- **`runAgent` requires a profile.** The model is offered only its tools, in
  registry order. A profile with no tools sends no tool schema at all.
- **A call outside the profile is refused** as an unknown tool, even if the
  tool is registered. The model can't grant itself a tool by naming it.
- **The registry refuses to start** if a profile names a tool that doesn't
  exist, since that would silently take the tool away.
- **The context owner decides what a turn leaves behind.** A `gateway` request
  is a live conversation: `runAgent` keeps its history, classifies follow-ups,
  and shows it on the display. A `caller` request is one piece of text a
  feature asked for: it starts from the system prompt alone, stores nothing and
  doesn't touch the display, even if it finishes after the caller stopped
  waiting. The caller shows Sakke speaking itself, when the satellite actually
  speaks (`showSpeakingWhile` in `features/display/`).
- **`announce` is in no profile.** Sakke already speaks its reply in a
  conversation; announcing is for speech at a scheduled time, run by the
  scheduler through `runTool` without a model or a profile.

A test checks that `sakke` lists every tool except the scheduler-only ones, so
a new tool can't be registered and silently never offered.

## Adding a tool

1. `tools/<name>/tool.ts` with the definition, and the executor in
   `tools/<name>/<name>.ts`, validating its arguments with Zod.
2. Put anything beyond a single call into a service under `features/`.
3. Add it to `ALL` in `tools/registry.ts`, and to the profiles that should
   have it (usually `sakke`).
4. If it may run from the scheduler, give it `schedulable`, and allow only the
   actions that make sense unattended.
5. If the model needs guidance, a `prompt.ts`, added to the system prompt's
   sections.
