# ClosedClaw v0 Design

**Date:** 2026-04-18
**Status:** Draft (awaiting user approval before writing-plans)
**Scope:** v0 only — personal-use learning project, distributed as an npm package, runnable bare-metal or via Docker.

## 1. Thesis

Build a Claude-Code-native agentic orchestration system, distributed as a reusable npm package `closedclaw`, that:

- receives messages from external channels (Telegram first) and from scheduled triggers (cron),
- routes them through a persistent **host** Claude Code session that chooses which worker to delegate to,
- dispatches work to **worker** Claude Code sessions, each with its own workspace directory, `CLAUDE.md`, persisted `session_id`, and private subagents,
- records telemetry via native Claude Code hooks,
- piggybacks on the operator's own Claude subscription by spawning the `claude` CLI — no API keys, no Agent SDK.

The dispatch boundary is protocol-agnostic: v0 host→worker calls go through a `closedclaw dispatch <agent>` subcommand invoked by the host's `Bash` tool. A future v1 swaps in an MCP tool without touching workers, channels, crons, hooks, or state.

## 2. Non-goals for v0

- Not multi-tenant. Single operator, single Claude subscription per running instance.
- Not horizontally scaled. Single Node process per deployment.
- Not production-grade reliability. In-memory queues, best-effort logs.
- Not a plugin framework. Adding Slack later is a code change, not a config change.
- Not a replacement for OpenClaw. This is a learning clone focused on Claude Code's native primitives.

## 3. Architecture

```
                   Telegram                cron tick
                      |                        |
        cloudflared tunnel                     |
                      |                        |
                      v                        v
            +-------------------+     +---------------+
            |  TelegramChannel  |     | CronTrigger   |
            +---------+---------+     +-------+-------+
                      |                       |
                      v                       v
                  +---------------------------------+
                  |          IngestBus              |
                  |  submit(ref, text) -> dispatch  |
                  +----------------+----------------+
                                   |
                                   v
                  +-----------------------------------+
                  |  dispatch/core.ts (protocol-free) |
                  |  per-agent mutex + FIFO queue     |
                  +-----------------+-----------------+
                                    |
                                    v
                  +-----------------------------------+
                  |  runner: spawn claude --resume    |
                  +-----------------+-----------------+
                                    |
                                    v
                  +--------------+  +--------------+  +---
                  | host session |  | backend-dev  |  |...
                  | (claude CLI) |  | session      |
                  +------+-------+  +--------------+
                         |
              (Bash tool) v
             +-------------------------+
             |  closedclaw dispatch    |----> dispatch/core.ts
             |  (re-enters via CLI)    |      (same mutex + queue)
             +-------------------------+

                           ^
                           |
          +----------------+----------------+
          |   CLI surface (closedclaw bin)  |
          |   init, start, add-agent,       |
          |   status, doctor, hook, dispatch|
          +---------------------------------+
```

### Components

| Component | Type | Responsibility |
|---|---|---|
| `src/cli.ts` | Node (bin) | `closedclaw` entrypoint; parses subcommands |
| `src/commands/*.ts` | Node | One subcommand each: `init`, `start`, `add-agent`, `status`, `doctor`, `hook`, `dispatch` |
| `src/orchestrator/server.ts` | Node | Boots Express, starts Channels + Triggers, wires IngestBus, handles SIGTERM |
| `src/orchestrator/channels/*.ts` | Node | `Channel` interface and implementations; `TelegramChannel` for v0 |
| `src/orchestrator/triggers/cron.ts` | Node | Loads all `**/crons.yaml` in the workspace, schedules with node-cron |
| `src/orchestrator/dispatch/core.ts` | Node | Per-agent mutex + FIFO queue; transport-free |
| `src/orchestrator/dispatch/runner.ts` | Node | Spawns `claude`, parses `stream-json`, captures result + session_id |
| `src/orchestrator/state.ts` | Node | Atomic read/write for `agents.json`, `state/*.json` |
| `src/orchestrator/workspace.ts` | Node | Resolves the active workspace path |
| `templates/**` | Files | Scaffolding copied by `closedclaw init` |
| Per-workspace `agents/<name>/` | Claude session | Routing brain (host) or specialist (workers) |

## 4. Distribution model

### 4.1 Published package

Published to npm as `closedclaw` (or scoped `@payam/closedclaw` if the unscoped name is taken). Contains:

- Compiled orchestrator + CLI in `dist/`.
- Scaffolding templates in `templates/`.
- `package.json` declares `"bin": { "closedclaw": "./dist/cli.js" }` and `"files": ["dist/", "templates/", "README.md"]`.
- Dependency on `@anthropic-ai/claude-code` is NOT declared — the operator installs `claude` CLI separately or uses the Docker image that bundles it.

### 4.2 Workspace location resolution

Resolved once at orchestrator boot (and by every `closedclaw` subcommand). First match wins:

1. CLI flag: `--workspace <path>`
2. Env var: `CLOSEDCLAW_WORKSPACE`
3. `./workspace/` relative to current working directory, if it exists (project-local dev mode)
4. Default: `~/.closedclaw/` (Unix) or `%USERPROFILE%\.closedclaw\` (Windows)

Orchestrator injects `CLOSEDCLAW_WORKSPACE=<absolute-path>` into the env of every spawned `claude` process, so `closedclaw hook` and `closedclaw dispatch` running inside those processes resolve to the same workspace.

### 4.3 Install flow on a new machine

```
npm install -g claude-code              # prerequisite: claude CLI on PATH
claude login                            # auth tokens saved to ~/.claude/
npm install -g closedclaw               # this package
closedclaw init                         # scaffolds ~/.closedclaw/ from templates
cd ~/.closedclaw && $EDITOR .env        # TELEGRAM_BOT_TOKEN, PUBLIC_BASE_URL
closedclaw doctor                       # verifies setup
closedclaw start                        # runs the orchestrator
```

### 4.4 What `closedclaw init` writes

Creates the workspace directory structure, copies templates, generates a webhook secret, writes an initial `agents.json` with `host`, `backend-dev`, `frontend-dev` entries (all `sessionId: null`). Refuses to overwrite an existing workspace unless `--force`.

## 5. File layout

### 5.1 Published package source (developer-facing)

```
closedclaw/                                # npm package source
├── package.json
├── tsconfig.json                          # outDir: dist/
├── .gitignore                             # excludes dist/, node_modules/, .env
├── README.md
├── LICENSE
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
│
├── src/
│   ├── cli.ts                             # `closedclaw` bin entrypoint
│   ├── commands/
│   │   ├── init.ts                        # scaffold a workspace
│   │   ├── start.ts                       # run the orchestrator
│   │   ├── add-agent.ts                   # scaffold a new agent dir
│   │   ├── status.ts                      # print agents.json + queue + tail log
│   │   ├── doctor.ts                      # diagnostics
│   │   ├── hook.ts                        # internal: stdin JSON -> system.log
│   │   └── dispatch.ts                    # internal: stdin -> dispatch() -> stdout
│   └── orchestrator/
│       ├── server.ts
│       ├── state.ts
│       ├── workspace.ts                   # workspace-location resolver
│       ├── channels/
│       │   ├── index.ts                   # Channel, ChannelRef, IngestBus, ChannelContext
│       │   ├── bus.ts                     # IngestBus impl
│       │   └── telegram.ts
│       ├── triggers/
│       │   ├── index.ts                   # Trigger, TriggerContext
│       │   └── cron.ts
│       └── dispatch/
│           ├── contract.ts                # DispatchRequest/Result types
│           ├── core.ts                    # dispatch() + queue + mutex
│           └── runner.ts                  # spawn claude; parse stream-json
│
├── templates/                             # copied verbatim by `closedclaw init`
│   ├── workspace/
│   │   ├── .env.example
│   │   ├── agents.json
│   │   └── crons.yaml
│   └── agents/
│       ├── host/
│       │   ├── CLAUDE.md
│       │   ├── crons.yaml
│       │   └── .claude/settings.json
│       ├── backend-dev/
│       │   ├── CLAUDE.md
│       │   ├── crons.yaml
│       │   └── .claude/
│       │       ├── settings.json
│       │       └── agents/
│       │           ├── api-writer.md
│       │           └── migration-writer.md
│       └── frontend-dev/
│           └── (same shape as backend-dev)
│
└── dist/                                  # build output (gitignored; shipped on publish)
```

### 5.2 Generated workspace on operator's machine

Created by `closedclaw init`. Default at `~/.closedclaw/`:

```
~/.closedclaw/
├── .env                                   # operator-supplied secrets
├── agents.json                            # { host, backend-dev, frontend-dev } records
├── crons.yaml                             # workspace-level schedules
├── system.log                             # telemetry append-only
│
├── state/
│   ├── secrets.json                       # auto-generated webhook secret
│   └── queue.log                          # enqueue/dequeue audit trail
│
└── agents/
    ├── host/
    │   ├── CLAUDE.md
    │   ├── crons.yaml
    │   ├── memory/routing.jsonl
    │   └── .claude/
    │       ├── settings.json
    │       └── agents/                    # host's native subagents (empty in v0)
    │
    ├── backend-dev/
    │   ├── CLAUDE.md
    │   ├── crons.yaml
    │   ├── memory/
    │   ├── dreams/                        # cron-written reflection markdown
    │   └── .claude/
    │       ├── settings.json
    │       └── agents/                    # grandchild subagents (in-session only)
    │           ├── api-writer.md
    │           └── migration-writer.md
    │
    └── frontend-dev/
        └── (same shape)
```

### 5.3 The three conceptual layers

1. **Package** (`src/`, `templates/`, `dist/`) — stateless, shipped by npm, identical across machines.
2. **Workspace** (`~/.closedclaw/` or overridden path) — all state. This is what the operator backs up.
3. **Per-agent subdir** (`~/.closedclaw/agents/<name>/`) — a standalone Claude Code project directory. Portable: drop any one into another tool and it still makes sense.

## 6. Core contracts

### 6.1 Dispatch

```ts
// src/orchestrator/dispatch/contract.ts

export interface DispatchRequest {
  agent: string;                  // must exist in agents.json
  payload: string;                // free-form task text
  correlationId?: string;         // for tracing; generated if absent
  timeoutMs?: number;             // default 300_000 (5 min); counts from enqueue
  origin?: {                      // provenance
    kind: "channel" | "trigger" | "host-delegation";
    name: string;                 // "telegram" | "cron" | "host"
  };
}

export type DispatchErrorCode =
  | "UNKNOWN_AGENT"
  | "WORKER_BUSY"
  | "WORKER_CRASH"
  | "TIMEOUT"
  | "INTERNAL";

export interface DispatchResult {
  ok: boolean;
  agent: string;
  sessionId: string;                       // final session_id (new or resumed)
  result?: string;                         // worker's final assistant message
  error?: { code: DispatchErrorCode; message: string };
  durationMs: number;                      // enqueue -> settle
  queuedMs: number;                        // enqueue -> start
  tokenUsage?: { input: number; output: number };
}

export async function dispatch(req: DispatchRequest): Promise<DispatchResult>;
```

### 6.2 Channel

```ts
// src/orchestrator/channels/index.ts

export interface ChannelRef {
  channel: string;                // "telegram"
  conversationId: string;         // chat_id as string
  userId?: string;
  raw?: unknown;                  // channel-specific reply context
}

export interface IngestBus {
  submit(ref: ChannelRef, text: string): Promise<void>;
}

export interface ChannelContext {
  app: express.Application;
  bus: IngestBus;
  config: Record<string, string>; // env-derived per-channel config
}

export interface Channel {
  name: string;
  start(ctx: ChannelContext): Promise<void>;
  stop(): Promise<void>;
  reply(ref: ChannelRef, text: string): Promise<void>;
}
```

### 6.3 Trigger

```ts
// src/orchestrator/triggers/index.ts

export interface Trigger {
  name: string;
  start(ctx: TriggerContext): Promise<void>;
  stop(): Promise<void>;
}

export interface TriggerContext {
  bus: IngestBus;                         // triggers publish through the same bus
  channels: Map<string, Channel>;         // for reply_to resolution
  registry: AgentRegistry;                // list of known agents
}
```

### 6.4 Agent registry entry

```ts
// src/orchestrator/state.ts

export interface AgentRecord {
  name: string;                   // "backend-dev"
  cwd: string;                    // absolute path to agents/<name>
  sessionId: string | null;       // null = never run; first run creates it
  createdAt: string;              // ISO
  lastActiveAt: string | null;
  model?: string;                 // passed as --model if set
}
```

`agents.json` shape: `{ "host": AgentRecord, "backend-dev": AgentRecord, ... }`. Writes are atomic (write-temp + rename). A single-generation backup is kept at `agents.json.bak`.

### 6.5 Cron spec (YAML)

```yaml
- id: backend-nightly-dream                 # unique across the whole workspace
  schedule: "0 3 * * *"                     # 5-field cron, UTC only in v0
  agent: backend-dev                        # must match agents.json
  payload: |
    Dream: review today's commits, note any smells,
    write summary to ./dreams/{{date}}.md
  reply_to: null                            # null or { channel, conversationId }
  timeoutMs: 600000
```

Loaded on boot from the union of `workspace/crons.yaml` and every `workspace/agents/*/crons.yaml`. Duplicate `id` across files is a fatal boot error.

## 7. Data flows

### 7.1 Telegram message → reply

1. Cloudflared tunnel forwards HTTPS to local Express on `PORT` (default 3000).
2. `POST /webhooks/telegram` handler validates `X-Telegram-Bot-Api-Secret-Token` against the value in `state/secrets.json`. Mismatch → **401**.
3. `TelegramChannel` parses the update, builds `ChannelRef { channel: "telegram", conversationId: String(chat_id), userId: String(from.id), raw: message }`, calls `bus.submit(ref, text)`.
4. `IngestBus.submit` wraps the text into `DispatchRequest { agent: "host", payload: text, origin: { kind: "channel", name: "telegram" } }` and calls `dispatch(req)`.
5. `dispatch/core.ts` checks host's queue depth. If < 10, enqueue and await mutex; else return `{ ok: false, error: { code: "WORKER_BUSY" } }` immediately. Every enqueue writes a line to `state/queue.log`.
6. When the host mutex is free, `runner.ts` spawns `claude` with `cwd = workspace/agents/host` and `env.CLOSEDCLAW_WORKSPACE = <abs-workspace-path>`:
   - **First run (sessionId is null):** `claude -p "<payload>" --output-format stream-json --verbose`. Runner reads the `system/init` event from stream-json, extracts `session_id`, and writes it back to `agents.json` atomically before the turn completes.
   - **Subsequent runs:** `claude -p "<payload>" --resume <sessionId> --output-format stream-json --verbose`.
   - If AgentRecord has `model` set, append `--model <model>`.
   - `--verbose` is required by Claude Code when `--output-format stream-json` is used non-interactively.
7. Host session wakes. `CLAUDE.md` + `.claude/agents/` load natively. Host reads the payload, decides which worker, runs Bash:
   ```
   echo "<refined task>" | closedclaw dispatch backend-dev
   ```
   `closedclaw` is on PATH because the npm package is globally installed (or, in Docker, baked in). No hardcoded relative paths.
8. `closedclaw dispatch backend-dev` reads stdin, resolves the current workspace via the standard resolution order, and calls `dispatch({ agent: "backend-dev", payload, origin: { kind: "host-delegation", name: "host" } })`.
9. Re-entry into `dispatch/core.ts` for backend-dev: same queue, same mutex, same runner. Backend-dev's session spawns, does its work, possibly using its own `.claude/agents/*` subagents via the native `Agent` tool (these run in-session, no dispatch round-trip).
10. Backend-dev returns its final message. Runner captures it from stream-json. `closedclaw dispatch` writes it to stdout, exits 0 on success, 1 on error. Host's Bash call sees clean text or `stderr` with a structured error code.
11. Host formulates a reply to the user. Its final stream-json message is captured by the top-level runner.
12. `IngestBus` resolves, calls `channels.get(ref.channel).reply(ref, text)`. `TelegramChannel.reply` calls Telegram's `sendMessage` with `chat_id = ref.conversationId`.

### 7.2 Cron tick → dispatch → optional reply

1. `node-cron` fires an entry.
2. `CronTrigger` builds `DispatchRequest { agent, payload, origin: { kind: "trigger", name: "cron" } }` and calls `dispatch(req)`.
3. Same queue/mutex/runner path.
4. On result:
   - If `reply_to === null`: append result to `system.log`, AND write `workspace/agents/<agent>/dreams/<ISO-timestamp>.md` containing payload + result.
   - If `reply_to` is set: `channels.get(reply_to.channel).reply({ channel, conversationId: reply_to.conversationId }, result.result)`.
5. Errors (`WORKER_BUSY`, `TIMEOUT`, `WORKER_CRASH`) are logged to `system.log` regardless of `reply_to`. If `reply_to` is set and the result failed, a short error string is delivered to the channel (e.g., *"cron `backend-nightly-dream` failed: TIMEOUT"*).

### 7.3 Hooks-driven telemetry

Each worker's `.claude/settings.json` installs the same hook set, all pointing at `closedclaw hook <event>`:

```json
{
  "hooks": {
    "SessionStart":     [{ "matcher": "*", "hooks": [{ "type": "command",
      "command": "closedclaw hook SessionStart" }] }],
    "SessionEnd":       [{ "matcher": "*", "hooks": [{ "type": "command",
      "command": "closedclaw hook SessionEnd" }] }],
    "UserPromptSubmit": [{ "matcher": "*", "hooks": [{ "type": "command",
      "command": "closedclaw hook UserPromptSubmit" }] }],
    "SubagentStart":    [{ "matcher": "*", "hooks": [{ "type": "command",
      "command": "closedclaw hook SubagentStart" }] }],
    "SubagentStop":     [{ "matcher": "*", "hooks": [{ "type": "command",
      "command": "closedclaw hook SubagentStop" }] }],
    "Stop":             [{ "matcher": "*", "hooks": [{ "type": "command",
      "command": "closedclaw hook Stop" }] }]
  }
}
```

`closedclaw hook`:
- Reads the JSON payload from **stdin** (correct Claude Code hook API; not env vars).
- Takes the event name from argv[2].
- Resolves the workspace via the standard order; the parent `claude` process was spawned with `CLOSEDCLAW_WORKSPACE` set, so this always resolves correctly.
- Augments the payload with `hook_event_name`, a UTC timestamp, and echoes `agent_id` / `session_id` for grep-ability.
- Appends one JSON line to `workspace/system.log`.
- Always exits 0 so hook failures never block a Claude turn.

## 8. Failure modes

| Condition | Detected by | Behavior |
|---|---|---|
| Unknown agent name in DispatchRequest | `core.ts` after reading agents.json | return `UNKNOWN_AGENT`; no spawn |
| Queue at depth 10 | `core.ts` on enqueue | return `WORKER_BUSY` immediately |
| Request older than `timeoutMs` before runner picks up | `core.ts` on dequeue | return `TIMEOUT`; no spawn |
| `claude` exits non-zero | `runner.ts` | capture stderr, return `WORKER_CRASH` with stderr tail |
| Runner produces no `result` message in stream-json before exit | `runner.ts` | return `WORKER_CRASH` with "no result produced" |
| Telegram rate limit 429 | `TelegramChannel.reply` | exponential backoff + retry up to 3 times; else log and drop |
| Invalid Telegram secret token | webhook handler | 401, no ingest, log |
| Tunnel down | Telegram side | Telegram retries per its policy; orchestrator unaware |
| `agents.json` corruption | `state.ts` on read | restore from `agents.json.bak`; log; if both bad, refuse to boot |
| Hook command fails (e.g. `closedclaw` not on PATH) | Claude Code | logged in transcript; non-fatal. `closedclaw doctor` detects preemptively |
| OAuth token expired in Docker | `runner.ts` | `claude` exits with auth error → `WORKER_CRASH`. Operator re-runs `claude login` on host |
| Restart mid-dispatch | OS signal | in-memory queue is lost; in-flight `claude` subprocess may complete but its result is dropped |
| SIGTERM | `server.ts` | stop channels, stop triggers, wait up to 30s for in-flight dispatches, exit |

## 9. File formats

### agents.json (generated by `closedclaw init`, mutated by runner)

```json
{
  "host": {
    "name": "host",
    "cwd": "/home/user/.closedclaw/agents/host",
    "sessionId": null,
    "createdAt": "2026-04-18T15:00:00Z",
    "lastActiveAt": null
  },
  "backend-dev": {
    "name": "backend-dev",
    "cwd": "/home/user/.closedclaw/agents/backend-dev",
    "sessionId": null,
    "createdAt": "2026-04-18T15:00:00Z",
    "lastActiveAt": null
  },
  "frontend-dev": { "...": "..." }
}
```

### templates/agents/host/CLAUDE.md

```md
# ClosedClaw Host

You are the router. Every user message arrives as your prompt. For each one:

1. Read the intent.
2. If it needs a specialist, delegate by running this Bash command:
       echo "<refined task>" | closedclaw dispatch <agent-name>
   `closedclaw` is on PATH. The current workspace is inherited automatically.
3. If the request is conversational, answer directly without delegating.
4. Write one JSON line to ./memory/routing.jsonl describing the decision.
5. Reply to the user with a 2-3 sentence summary of the outcome.

Available workers (exact names for `closedclaw dispatch`):
- backend-dev   — APIs, DB, server-side auth, Node/Express
- frontend-dev  — React, CSS, client state

When dispatch returns an error on stderr:
- WORKER_BUSY: tell the user the worker is busy, ask them to retry in ~30s.
- TIMEOUT: apologize, do not auto-retry.
- UNKNOWN_AGENT: you made a typo. List the real agents and try again.
- WORKER_CRASH: tell the user something went wrong; include the short error.
```

### templates/agents/backend-dev/CLAUDE.md

```md
# backend-dev

Senior backend engineer. Work in THIS directory's cwd as the codebase root.
- Always validate inputs.
- Follow conventions in ./routes and ./db.
- After writing code, run `npm test` and include the result in your reply.
- On ambiguity, ask one clarifying question before coding.
```

### templates/agents/backend-dev/.claude/agents/api-writer.md

```md
---
name: api-writer
description: Use for writing REST endpoint handler code only. Does not touch DB schema or migrations.
tools: Read, Write, Edit, Grep, Glob
model: sonnet
---

You write Express route handlers. Keep each handler under 50 lines.
Return 400 on validation errors, 500 only on unhandled server errors.
```

### templates/workspace/crons.yaml

```yaml
# Workspace-level system crons.
- id: rotate-system-log
  schedule: "0 0 * * *"                  # midnight UTC daily
  agent: host
  payload: |
    System task: check ./system.log size. If > 10 MB, rename to
    system.log.<date> and start fresh. Report what you did.
  reply_to: null
  timeoutMs: 120000
```

### templates/agents/backend-dev/crons.yaml

```yaml
- id: backend-nightly-dream
  schedule: "0 3 * * *"
  agent: backend-dev
  payload: |
    Dream: review today's activity in this workspace. Note smells,
    unfinished work, ideas for tomorrow. Save to ./dreams/{{date}}.md.
  reply_to: null
  timeoutMs: 600000
```

### templates/workspace/.env.example

```
# Claude CLI on PATH is required. No API key needed.
PORT=3000
PUBLIC_BASE_URL=https://your-tunnel.example.com
TELEGRAM_BOT_TOKEN=1234567890:AAA-your-bot-token
# TELEGRAM_WEBHOOK_SECRET is auto-generated on first boot; do NOT set manually.
```

## 10. CLI surface

```
closedclaw init                     Scaffold a new workspace at ~/.closedclaw/
closedclaw init --dir ./work        Scaffold at a specific location
closedclaw init --force             Overwrite an existing workspace
closedclaw start                    Run the orchestrator against the resolved workspace
closedclaw start --workspace PATH   Override workspace location for this run
closedclaw add-agent <name>         Scaffold a new agent in the current workspace
closedclaw status                   Print agents.json, queue depth per agent, tail of system.log
closedclaw doctor                   Verify: claude on PATH, claude auth valid,
                                    closedclaw on PATH, bot token set, tunnel URL reachable,
                                    workspace structure intact, hook entrypoints resolvable
closedclaw hook <event>             INTERNAL: read JSON from stdin, append to system.log
closedclaw dispatch <agent>         INTERNAL: read stdin as payload, run dispatch(), write result to stdout
```

`hook` and `dispatch` are hidden from top-level `--help` output (marked with a leading `_` or via commander's hidden flag). They exist for Claude Code to call, not for humans.

## 11. Bash → MCP migration path

When v0 is stable, migrate the host→worker transport from `Bash(closedclaw dispatch ...)` to an MCP tool.

**Changes required:**

1. Add `src/orchestrator/dispatch/mcp-server.ts` (~40 LOC) — a stdio MCP server exposing one tool `delegate_task({ agent, payload }) → text`. Internally calls the same `dispatch()`.
2. Expose a new subcommand `closedclaw mcp-server` that runs the stdio server.
3. Add a host template update: `templates/agents/host/.mcp.json`:
   ```json
   {
     "mcpServers": {
       "dispatch": {
         "command": "closedclaw",
         "args": ["mcp-server"]
       }
     }
   }
   ```
4. Update `templates/agents/host/CLAUDE.md`: replace the `closedclaw dispatch` Bash instruction with *"Call the `delegate_task` tool."*

**Unchanged:** `dispatch/core.ts`, `runner.ts`, `contract.ts`, all workers, all channels, cron, logger, state, hooks, `agents.json`, worker `CLAUDE.md`s. That is the payoff of the abstraction.

## 12. Deployment

Three deployment modes ship from the same package and image. Operator chooses per-machine.

### 12.1 Bare-metal (dev loop, simplest)

```bash
npm install -g @anthropic-ai/claude-code
claude login
npm install -g closedclaw
closedclaw init
$EDITOR ~/.closedclaw/.env
closedclaw doctor
closedclaw start
```

### 12.2 Single Docker container

The package ships a `Dockerfile` that produces an image containing Node, the compiled `closedclaw`, and the `claude` CLI. The image mounts two volumes: the workspace and the host's Claude auth directory.

```dockerfile
# --- stage 1: build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
COPY templates/ ./templates/
RUN npm run build

# --- stage 2: runtime
FROM node:20-alpine
RUN apk add --no-cache bash git curl \
    && npm install -g @anthropic-ai/claude-code

ARG UID=1000
ARG GID=1000
RUN addgroup -g ${GID} agent && adduser -u ${UID} -G agent -s /bin/sh -D agent

WORKDIR /app
COPY --from=builder --chown=agent:agent /app/dist ./dist
COPY --from=builder --chown=agent:agent /app/templates ./templates
COPY --from=builder --chown=agent:agent /app/package.json ./
RUN npm install --omit=dev && npm link

USER agent
ENV CLOSEDCLAW_WORKSPACE=/workspace
VOLUME ["/workspace", "/home/agent/.claude"]
EXPOSE 3000
CMD ["closedclaw", "start"]
```

Run:

```bash
# host-side one-time setup
claude login

# build + run
docker build -t closedclaw:latest --build-arg UID=$(id -u) --build-arg GID=$(id -g) .
docker run -d --name closedclaw \
  -p 3000:3000 \
  -v closedclaw-workspace:/workspace \
  -v ~/.claude:/home/agent/.claude:rw \
  --env-file .env \
  closedclaw:latest

docker exec closedclaw closedclaw init
docker restart closedclaw
```

### 12.3 Docker Compose (with cloudflared sidecar)

```yaml
services:
  closedclaw:
    build: .
    image: closedclaw:latest
    restart: unless-stopped
    env_file: .env
    environment:
      PUBLIC_BASE_URL: ${PUBLIC_BASE_URL}
      PORT: 3000
    volumes:
      - closedclaw-workspace:/workspace
      - ${HOME}/.claude:/home/agent/.claude:rw
    ports:
      - "3000:3000"
    depends_on:
      - cloudflared

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}

volumes:
  closedclaw-workspace:
```

Run:

```bash
claude login                        # one-time on host
cp .env.example .env
$EDITOR .env                        # TELEGRAM_BOT_TOKEN, CLOUDFLARE_TUNNEL_TOKEN, PUBLIC_BASE_URL
docker compose up -d
docker compose exec closedclaw closedclaw init
docker compose restart closedclaw
```

### 12.4 Deployment gotchas

1. **OAuth token refresh in containers.** If the `claude` CLI's token expires and needs re-auth, the container cannot open a browser. Fix: run `claude -p "hello"` on the host; it refreshes the shared `~/.claude/` tokens. The container picks them up on the next spawn. `closedclaw doctor` inside the container warns if the token is approaching expiry (check file mtime as a proxy).
2. **UID mismatch on Linux hosts.** If your host user isn't UID 1000, mounted `~/.claude/` may be unwritable inside the container. Fix: build with `--build-arg UID=$(id -u) --build-arg GID=$(id -g)`.
3. **Concurrent access to `~/.claude/`.** Claude CLI processes on host + inside container writing to the same token store is theoretically fine (OAuth refresh is atomic) but if you see weird auth errors, stop host-side `claude` usage while the container runs.
4. **`.dockerignore` must exclude `node_modules/`, `dist/`, `.env`, `workspace/`** to avoid leaking dev artifacts into the image.
5. **`docker compose down -v` wipes the workspace volume.** Use plain `docker compose down` to preserve state across restarts.

## 13. v0 deliverable checklist

Ordered roughly by implementation sequence.

### Package scaffolding

- [ ] `package.json` with dependencies: `express`, `node-cron`, `yaml`, `dotenv`, `undici`, `commander`. DevDeps: `typescript`, `@types/node`, `@types/express`. Scripts: `build`, `start`, `dev`, `prepublishOnly`. `bin: { "closedclaw": "./dist/cli.js" }`. `files: ["dist/", "templates/", "README.md"]`.
- [ ] `tsconfig.json`: `outDir: "dist"`, `rootDir: "src"`, `module: "NodeNext"`, `target: "ES2022"`, `strict: true`.
- [ ] `.gitignore` excluding `dist/`, `node_modules/`, `.env`, `workspace/`.
- [ ] `.dockerignore`.
- [ ] `README.md` with install + run + cloudflared setup.

### CLI + orchestrator code

- [ ] `src/cli.ts` — commander entrypoint, wires subcommands, resolves workspace.
- [ ] `src/orchestrator/workspace.ts` — resolver with the documented precedence.
- [ ] `src/orchestrator/state.ts` — atomic JSON I/O.
- [ ] `src/commands/init.ts` — copies templates/, substitutes absolute paths, generates webhook secret.
- [ ] `src/commands/doctor.ts` — runs all diagnostics.
- [ ] `src/commands/status.ts`, `add-agent.ts`.
- [ ] `src/commands/hook.ts` — internal, stdin-JSON → system.log.
- [ ] `src/commands/dispatch.ts` — internal, stdin-payload → dispatch() → stdout.
- [ ] `src/orchestrator/server.ts` — Express, bus, channel/trigger lifecycle, SIGTERM.
- [ ] `src/orchestrator/channels/{index.ts, bus.ts, telegram.ts}`.
- [ ] `src/orchestrator/triggers/{index.ts, cron.ts}`.
- [ ] `src/orchestrator/dispatch/{contract.ts, core.ts, runner.ts}`.

### Templates

- [ ] `templates/workspace/{.env.example, agents.json, crons.yaml}`.
- [ ] `templates/agents/host/{CLAUDE.md, crons.yaml, .claude/settings.json}`.
- [ ] `templates/agents/backend-dev/` with CLAUDE.md, crons.yaml, .claude/settings.json, and two grandchild subagents.
- [ ] `templates/agents/frontend-dev/` with same shape.

### Docker

- [ ] `Dockerfile` (multi-stage as above).
- [ ] `docker-compose.yml` with cloudflared sidecar.
- [ ] README Docker section.

### Smoke tests

- [ ] `closedclaw init && closedclaw doctor` on a clean machine reports all green.
- [ ] Telegram message end-to-end: send "build a login API", verify it reaches backend-dev and replies. Check `system.log` shows `SessionStart` → `UserPromptSubmit` → `Stop` for host and backend-dev.
- [ ] Fire `backend-nightly-dream` cron manually (via a `scripts/fire-cron.ts` helper or by editing the schedule to `* * * * *` temporarily): verify `dreams/<ts>.md` written and `system.log` records it.
- [ ] Burst test: send 11 Telegram messages in 2 seconds; verify the 11th returns a `WORKER_BUSY`-derived reply via the host.
- [ ] Docker: `docker compose up`, repeat the three tests above.

## 14. Deferred to v1+

Ranked by likely order of value:

1. **MCP transport** for host→worker dispatch (path documented in §11).
2. **Explicit memory files** per worker (`memory/*.md` `@`-imported into `CLAUDE.md`), fed by existing `dreams/` output.
3. **`closedclaw spawn` wizard** — interactive agent scaffolder beyond `add-agent`.
4. **Spawner meta-agent** — a Claude session that creates new workers for you.
5. **Multi-channel ingest** — Slack, Discord. Trivial given the Channel abstraction.
6. **Persistent queue** — SQLite-backed so restart doesn't lose in-flight work.
7. **Timezone-aware cron**.
8. **Dashboard** — web UI reading `system.log` + `agents.json`.
9. **Parallel workers per agent** via session pools.
10. **Image publishing** to GHCR / Docker Hub.

## 15. Open questions acknowledged, deferred

- What exactly is in a worker's working directory when it writes code? v0 assumes the worker's cwd is its own agent workspace dir and the worker does all file work there. If it needs to edit a real external repo, it runs `cd /path/to/repo` via Bash. This keeps the package portable.
- What happens if the host itself crashes mid-delegation (host session dies between the Bash call and the user reply)? v0: the worker's turn completes and its result is logged; the user gets no reply. Accepted.
- Compaction strategy for host and workers. v0 relies on Claude Code's built-in auto-compact. When it becomes a problem, adopt the explicit-memory upgrade from deferred item #2.
- Multiple workspaces per operator (e.g., different bot + agent set per project). v0 supports this via `CLOSEDCLAW_WORKSPACE` / `--workspace`, but only one can run at a time on the same PORT. Running multiple simultaneously requires different ports and different tunnels; left to operator docs.
