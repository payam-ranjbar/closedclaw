# ClosedClaw v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `closedclaw` npm package implementing the design in `docs/superpowers/specs/2026-04-18-closedclaw-design.md` — a Claude-Code-native agent orchestrator with a persistent host router, per-worker Claude sessions, Telegram ingest, cron triggers, hooks-based telemetry, and Docker deployment.

**Architecture:** Node.js package (TypeScript → compiled JS in `dist/`). A single-process Express server hosts an IngestBus; Channels and Triggers publish into it; a protocol-agnostic `dispatch()` core queues work per agent and spawns `claude` CLI subprocesses with `--resume <session_id>`. Host-to-worker delegation happens via `closedclaw dispatch <agent>` invoked from the host's `Bash` tool. Hook telemetry via `closedclaw hook <event>`.

**Tech Stack:** Node.js 20+, TypeScript (strict), ESM (`NodeNext`), Express 4, node-cron, undici, commander, yaml, dotenv. Vitest for tests. `claude` CLI (user-installed) spawned as child_process. Docker (multi-stage) + docker-compose + cloudflared sidecar for deployment.

---

## Code style rules (applied to ALL code in this plan)

1. **No subjective or state-change comments.** Never write "now we do X," "this replaces old Y," "TODO: fix later," or comments narrating what the code is about to do.
2. **No spam comments.** Do not write comments that restate what the code says. `// open the file` above `await fs.open(...)` is banned.
3. **Inline short comments only when they explain a non-obvious WHY.** A hidden invariant, a platform quirk, a workaround for a specific upstream bug. Never explain WHAT — names do that. If removing the comment wouldn't confuse a reader, do not write it.
4. **One Node.js convention across the codebase:** TypeScript with ES modules. `"type": "module"` in package.json. `NodeNext` resolution. All imports use explicit `.js` extensions (required by ESM+TS). No CommonJS `require`, no `__dirname`, no mixed module styles. Use `fileURLToPath(import.meta.url)` when a path anchor is needed.
5. **Error handling only at system boundaries.** Validate at channel-ingest, CLI args, and external-API responses. Do not wrap internal calls in try/catch "just in case."
6. **No feature flags, no backwards-compat shims, no dead branches.** If a code path isn't reachable today, delete it.

---

## File structure overview

```
closedclaw/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
├── .dockerignore
├── README.md
├── Dockerfile
├── docker-compose.yml
├── .env.example
│
├── src/
│   ├── cli.ts
│   ├── commands/
│   │   ├── init.ts
│   │   ├── start.ts
│   │   ├── add-agent.ts
│   │   ├── status.ts
│   │   ├── doctor.ts
│   │   ├── hook.ts
│   │   └── dispatch.ts
│   └── orchestrator/
│       ├── server.ts
│       ├── state.ts
│       ├── workspace.ts
│       ├── util/
│       │   └── read-stream.ts
│       ├── channels/
│       │   ├── index.ts
│       │   ├── bus.ts
│       │   └── telegram.ts
│       ├── triggers/
│       │   ├── index.ts
│       │   └── cron.ts
│       └── dispatch/
│           ├── contract.ts
│           ├── core.ts
│           └── runner.ts
│
├── templates/
│   ├── workspace/
│   │   ├── .env.example
│   │   ├── agents.json
│   │   └── crons.yaml
│   └── agents/
│       ├── host/…
│       ├── backend-dev/…
│       └── frontend-dev/…
│
├── tests/
│   ├── workspace.test.ts
│   ├── state.test.ts
│   ├── dispatch-core.test.ts
│   ├── runner.test.ts
│   ├── bus.test.ts
│   ├── telegram.test.ts
│   ├── cron.test.ts
│   ├── hook-command.test.ts
│   ├── dispatch-command.test.ts
│   └── init-command.test.ts
│
└── dist/                          (build output; gitignored)
```

**File responsibilities (one line each):**

- `cli.ts` — commander entrypoint, registers all subcommands, resolves workspace once.
- `commands/init.ts` — copy templates, generate secret, write initial `agents.json`.
- `commands/start.ts` — boot orchestrator server.
- `commands/add-agent.ts` — scaffold one new agent dir inside existing workspace.
- `commands/status.ts` — read `agents.json`, queue sizes, tail system.log; pretty-print.
- `commands/doctor.ts` — run diagnostics, exit non-zero if any fail.
- `commands/hook.ts` — stdin JSON → augment → append to `system.log`.
- `commands/dispatch.ts` — stdin payload → `dispatch()` → stdout result, stderr error code.
- `orchestrator/server.ts` — Express app, bus wiring, channel/trigger lifecycle, SIGTERM.
- `orchestrator/state.ts` — `AgentRecord`, atomic reads/writes for `agents.json` and `state/*.json`.
- `orchestrator/workspace.ts` — resolve workspace path from flag/env/cwd/home.
- `orchestrator/util/read-stream.ts` — `readAll(stream)` helper used by `hook` and `dispatch`.
- `orchestrator/channels/index.ts` — `Channel`, `ChannelRef`, `IngestBus`, `ChannelContext` types.
- `orchestrator/channels/bus.ts` — `IngestBusImpl` — receives channel submissions, calls `dispatch({ agent: "host" })`, routes replies back.
- `orchestrator/channels/telegram.ts` — `TelegramChannel` — webhook mount, secret validation, `setWebhook`, reply via Bot API.
- `orchestrator/triggers/index.ts` — `Trigger`, `TriggerContext` types, `CronSpec` type.
- `orchestrator/triggers/cron.ts` — `CronTrigger` — load all `**/crons.yaml`, register with node-cron, dispatch on tick, route `reply_to`.
- `orchestrator/dispatch/contract.ts` — `DispatchRequest`, `DispatchResult`, `DispatchErrorCode`.
- `orchestrator/dispatch/core.ts` — per-agent mutex + bounded FIFO queue + timeouts; calls runner.
- `orchestrator/dispatch/runner.ts` — `child_process.spawn("claude", …)`, parses `stream-json`, captures `session_id` and final result, writes state.

---

## Task 0: Repository initialization

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `README.md`

- [ ] **Step 1: Initialize git and create package.json**

```bash
git init
```

Create `package.json`:

```json
{
  "name": "closedclaw",
  "version": "0.1.0",
  "description": "Claude-Code-native agent orchestrator",
  "type": "module",
  "bin": { "closedclaw": "./dist/cli.js" },
  "files": ["dist/", "templates/", "README.md", "LICENSE"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc",
    "start": "node dist/cli.js start",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "node-cron": "^3.0.3",
    "undici": "^6.19.2",
    "yaml": "^2.5.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@types/node-cron": "^3.0.11",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
.env
workspace/
*.log
coverage/
.DS_Store
```

- [ ] **Step 5: Install and verify build**

```bash
npm install
npx tsc --noEmit
```

Expected: no output (clean type check, no source files yet).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: initialize package skeleton"
```

---

## Task 1: Workspace path resolver

**Files:**
- Create: `src/orchestrator/workspace.ts`
- Test: `tests/workspace.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/workspace.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveWorkspace } from "../src/orchestrator/workspace.js";

describe("resolveWorkspace", () => {
  let tmp: string;
  const origEnv = process.env.CLOSEDCLAW_WORKSPACE;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cc-ws-"));
    delete process.env.CLOSEDCLAW_WORKSPACE;
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (origEnv) process.env.CLOSEDCLAW_WORKSPACE = origEnv;
  });

  it("prefers the --workspace flag over everything else", () => {
    process.env.CLOSEDCLAW_WORKSPACE = "/env/path";
    expect(resolveWorkspace({ flag: tmp })).toBe(resolve(tmp));
  });

  it("falls back to CLOSEDCLAW_WORKSPACE env var", () => {
    process.env.CLOSEDCLAW_WORKSPACE = tmp;
    expect(resolveWorkspace({})).toBe(resolve(tmp));
  });

  it("falls back to ./workspace if present", () => {
    const cwdWs = join(tmp, "workspace");
    mkdirSync(cwdWs);
    expect(resolveWorkspace({ cwd: tmp })).toBe(resolve(cwdWs));
  });

  it("falls back to ~/.closedclaw when nothing else matches", () => {
    expect(resolveWorkspace({ cwd: tmp })).toBe(join(homedir(), ".closedclaw"));
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npx vitest run tests/workspace.test.ts
```

Expected: all 4 tests fail with "Cannot find module".

- [ ] **Step 3: Implement resolver**

Create `src/orchestrator/workspace.ts`:

```ts
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface ResolveOptions {
  flag?: string;
  cwd?: string;
}

export function resolveWorkspace(opts: ResolveOptions = {}): string {
  if (opts.flag) return resolve(opts.flag);

  const envVar = process.env.CLOSEDCLAW_WORKSPACE;
  if (envVar) return resolve(envVar);

  const cwdWorkspace = join(opts.cwd ?? process.cwd(), "workspace");
  if (existsSync(cwdWorkspace) && statSync(cwdWorkspace).isDirectory()) {
    return resolve(cwdWorkspace);
  }

  return join(homedir(), ".closedclaw");
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run tests/workspace.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/workspace.ts tests/workspace.test.ts
git commit -m "feat(orchestrator): workspace path resolver"
```

---

## Task 2: State layer — agents.json atomic I/O

**Files:**
- Create: `src/orchestrator/state.ts`
- Test: `tests/state.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/state.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAgents, writeAgents, updateAgent, type AgentRecord } from "../src/orchestrator/state.js";

describe("state: agents.json", () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "cc-state-"));
  });

  it("reads an empty object when file missing", async () => {
    expect(await readAgents(ws)).toEqual({});
  });

  it("writes atomically and reads back", async () => {
    const rec: AgentRecord = {
      name: "host", cwd: "/x", sessionId: null,
      createdAt: "2026-04-18T00:00:00Z", lastActiveAt: null,
    };
    await writeAgents(ws, { host: rec });
    expect(await readAgents(ws)).toEqual({ host: rec });
    expect(existsSync(join(ws, "agents.json"))).toBe(true);
  });

  it("restores from .bak when main file is corrupt", async () => {
    writeFileSync(join(ws, "agents.json.bak"), JSON.stringify({
      host: { name: "host", cwd: "/x", sessionId: null, createdAt: "t", lastActiveAt: null }
    }));
    writeFileSync(join(ws, "agents.json"), "not json");
    const result = await readAgents(ws);
    expect(result.host.name).toBe("host");
  });

  it("updateAgent merges one record without clobbering others", async () => {
    const h: AgentRecord = { name: "host", cwd: "/h", sessionId: null, createdAt: "t", lastActiveAt: null };
    const b: AgentRecord = { name: "backend-dev", cwd: "/b", sessionId: null, createdAt: "t", lastActiveAt: null };
    await writeAgents(ws, { host: h, "backend-dev": b });
    await updateAgent(ws, "backend-dev", { sessionId: "abc", lastActiveAt: "now" });
    const result = await readAgents(ws);
    expect(result["backend-dev"].sessionId).toBe("abc");
    expect(result.host.sessionId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npx vitest run tests/state.test.ts
```

Expected: all tests fail with "Cannot find module".

- [ ] **Step 3: Implement state module**

Create `src/orchestrator/state.ts`:

```ts
import { promises as fs } from "node:fs";
import { join } from "node:path";

export interface AgentRecord {
  name: string;
  cwd: string;
  sessionId: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  model?: string;
}

export type AgentRegistry = Record<string, AgentRecord>;

const FILE = "agents.json";
const BAK = "agents.json.bak";

export async function readAgents(workspace: string): Promise<AgentRegistry> {
  const primary = join(workspace, FILE);
  try {
    const raw = await fs.readFile(primary, "utf8");
    return JSON.parse(raw);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    const bak = join(workspace, BAK);
    const raw = await fs.readFile(bak, "utf8");
    return JSON.parse(raw);
  }
}

export async function writeAgents(workspace: string, registry: AgentRegistry): Promise<void> {
  const primary = join(workspace, FILE);
  const bak = join(workspace, BAK);
  const tmp = `${primary}.tmp-${process.pid}-${Date.now()}`;

  try {
    const existing = await fs.readFile(primary, "utf8");
    await fs.writeFile(bak, existing);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  await fs.writeFile(tmp, JSON.stringify(registry, null, 2));
  await fs.rename(tmp, primary);
}

export async function updateAgent(
  workspace: string,
  name: string,
  patch: Partial<AgentRecord>,
): Promise<void> {
  const registry = await readAgents(workspace);
  const current = registry[name];
  if (!current) throw new Error(`unknown agent: ${name}`);
  registry[name] = { ...current, ...patch };
  await writeAgents(workspace, registry);
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run tests/state.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/state.ts tests/state.test.ts
git commit -m "feat(state): atomic agents.json I/O with backup recovery"
```

---

## Task 3: Dispatch contract types

**Files:**
- Create: `src/orchestrator/dispatch/contract.ts`

No tests — pure type declarations.

- [ ] **Step 1: Create contract.ts**

```ts
export interface DispatchRequest {
  agent: string;
  payload: string;
  correlationId?: string;
  timeoutMs?: number;
  origin?: {
    kind: "channel" | "trigger" | "host-delegation";
    name: string;
  };
}

export type DispatchErrorCode =
  | "UNKNOWN_AGENT"
  | "WORKER_BUSY"
  | "WORKER_CRASH"
  | "TIMEOUT"
  | "INTERNAL";

export interface DispatchError {
  code: DispatchErrorCode;
  message: string;
}

export interface DispatchResult {
  ok: boolean;
  agent: string;
  sessionId: string;
  result?: string;
  error?: DispatchError;
  durationMs: number;
  queuedMs: number;
  tokenUsage?: { input: number; output: number };
}

export interface RunnerOutcome {
  sessionId: string;
  result: string;
  tokenUsage?: { input: number; output: number };
}

export interface Runner {
  run(args: { agent: string; payload: string; workspace: string }): Promise<RunnerOutcome>;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/orchestrator/dispatch/contract.ts
git commit -m "feat(dispatch): define DispatchRequest/Result contract"
```

---

## Task 4: Dispatch core with queue and mutex (mocked runner)

**Files:**
- Create: `src/orchestrator/dispatch/core.ts`
- Test: `tests/dispatch-core.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/dispatch-core.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDispatcher } from "../src/orchestrator/dispatch/core.js";
import { writeAgents } from "../src/orchestrator/state.js";
import type { Runner, RunnerOutcome } from "../src/orchestrator/dispatch/contract.js";

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function fakeRunner(outcomes: (() => Promise<RunnerOutcome>)[]): Runner {
  let i = 0;
  return {
    run: async () => {
      const fn = outcomes[i++];
      if (!fn) throw new Error("runner called too many times");
      return fn();
    },
  };
}

describe("dispatcher", () => {
  let ws: string;

  beforeEach(async () => {
    ws = mkdtempSync(join(tmpdir(), "cc-disp-"));
    await writeAgents(ws, {
      host: { name: "host", cwd: join(ws, "agents/host"),
              sessionId: "s-host", createdAt: "t", lastActiveAt: null },
      "backend-dev": { name: "backend-dev", cwd: join(ws, "agents/backend-dev"),
                       sessionId: "s-be", createdAt: "t", lastActiveAt: null },
    });
  });

  it("returns UNKNOWN_AGENT when agent missing", async () => {
    const d = createDispatcher({ workspace: ws, runner: fakeRunner([]) });
    const r = await d.dispatch({ agent: "ghost", payload: "hi" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("UNKNOWN_AGENT");
  });

  it("passes through a successful runner result", async () => {
    const d = createDispatcher({
      workspace: ws,
      runner: fakeRunner([async () => ({ sessionId: "s-host", result: "ok" })]),
    });
    const r = await d.dispatch({ agent: "host", payload: "x" });
    expect(r.ok).toBe(true);
    expect(r.result).toBe("ok");
    expect(r.sessionId).toBe("s-host");
  });

  it("serializes concurrent calls to the same agent", async () => {
    const timeline: string[] = [];
    const d = createDispatcher({
      workspace: ws,
      runner: fakeRunner([
        async () => { timeline.push("a-start"); await delay(50); timeline.push("a-end"); return { sessionId: "s-host", result: "a" }; },
        async () => { timeline.push("b-start"); await delay(10); timeline.push("b-end"); return { sessionId: "s-host", result: "b" }; },
      ]),
    });
    const [ra, rb] = await Promise.all([
      d.dispatch({ agent: "host", payload: "1" }),
      d.dispatch({ agent: "host", payload: "2" }),
    ]);
    expect(ra.result).toBe("a");
    expect(rb.result).toBe("b");
    expect(timeline).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("runs different agents in parallel", async () => {
    const timeline: string[] = [];
    const d = createDispatcher({
      workspace: ws,
      runner: fakeRunner([
        async () => { timeline.push("host-start"); await delay(40); timeline.push("host-end"); return { sessionId: "s-host", result: "h" }; },
        async () => { timeline.push("be-start"); await delay(10); timeline.push("be-end"); return { sessionId: "s-be", result: "b" }; },
      ]),
    });
    await Promise.all([
      d.dispatch({ agent: "host", payload: "1" }),
      d.dispatch({ agent: "backend-dev", payload: "2" }),
    ]);
    expect(timeline[0]).toBe("host-start");
    expect(timeline[1]).toBe("be-start");
  });

  it("returns WORKER_BUSY when queue depth exceeds 10", async () => {
    const outcomes = Array.from({ length: 11 }, () =>
      async () => { await delay(30); return { sessionId: "s-host", result: "ok" }; },
    );
    const d = createDispatcher({ workspace: ws, runner: fakeRunner(outcomes), maxQueue: 10 });
    const results = await Promise.all(
      Array.from({ length: 12 }, () => d.dispatch({ agent: "host", payload: "x" })),
    );
    const busy = results.filter(r => !r.ok && r.error?.code === "WORKER_BUSY");
    expect(busy.length).toBeGreaterThanOrEqual(1);
  });

  it("returns TIMEOUT when enqueue-to-start exceeds timeoutMs", async () => {
    const d = createDispatcher({
      workspace: ws,
      runner: fakeRunner([
        async () => { await delay(200); return { sessionId: "s-host", result: "slow" }; },
        async () => ({ sessionId: "s-host", result: "ok" }),
      ]),
    });
    const [r1, r2] = await Promise.all([
      d.dispatch({ agent: "host", payload: "1" }),
      d.dispatch({ agent: "host", payload: "2", timeoutMs: 50 }),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(r2.error?.code).toBe("TIMEOUT");
  });

  it("returns WORKER_CRASH when runner throws", async () => {
    const d = createDispatcher({
      workspace: ws,
      runner: fakeRunner([async () => { throw new Error("boom"); }]),
    });
    const r = await d.dispatch({ agent: "host", payload: "x" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("WORKER_CRASH");
    expect(r.error?.message).toContain("boom");
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run tests/dispatch-core.test.ts
```

Expected: all tests fail.

- [ ] **Step 3: Implement dispatcher**

Create `src/orchestrator/dispatch/core.ts`:

```ts
import { readAgents, updateAgent } from "../state.js";
import type {
  DispatchRequest,
  DispatchResult,
  DispatchErrorCode,
  Runner,
} from "./contract.js";

interface Options {
  workspace: string;
  runner: Runner;
  maxQueue?: number;
}

interface QueueEntry {
  req: DispatchRequest;
  enqueuedAt: number;
  resolve: (r: DispatchResult) => void;
}

export interface Dispatcher {
  dispatch(req: DispatchRequest): Promise<DispatchResult>;
}

const DEFAULT_MAX_QUEUE = 10;
const DEFAULT_TIMEOUT_MS = 300_000;

export function createDispatcher(opts: Options): Dispatcher {
  const maxQueue = opts.maxQueue ?? DEFAULT_MAX_QUEUE;
  const queues = new Map<string, QueueEntry[]>();
  const running = new Set<string>();

  async function processNext(agent: string): Promise<void> {
    if (running.has(agent)) return;
    const q = queues.get(agent);
    if (!q || q.length === 0) return;

    running.add(agent);
    const entry = q.shift()!;
    entry.resolve(await runOne(agent, entry));
    running.delete(agent);
    void processNext(agent);
  }

  async function runOne(agent: string, entry: QueueEntry): Promise<DispatchResult> {
    const startedAt = Date.now();
    const queuedMs = startedAt - entry.enqueuedAt;
    const timeoutMs = entry.req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (queuedMs > timeoutMs) {
      return failure(entry, "TIMEOUT", `queued for ${queuedMs}ms (limit ${timeoutMs}ms)`, queuedMs, 0);
    }

    try {
      const outcome = await opts.runner.run({
        agent, payload: entry.req.payload, workspace: opts.workspace,
      });
      await updateAgent(opts.workspace, agent, {
        sessionId: outcome.sessionId,
        lastActiveAt: new Date().toISOString(),
      });
      return {
        ok: true,
        agent,
        sessionId: outcome.sessionId,
        result: outcome.result,
        durationMs: Date.now() - entry.enqueuedAt,
        queuedMs,
        tokenUsage: outcome.tokenUsage,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return failure(entry, "WORKER_CRASH", msg, queuedMs, Date.now() - startedAt);
    }
  }

  function failure(
    entry: QueueEntry,
    code: DispatchErrorCode,
    message: string,
    queuedMs: number,
    workMs: number,
  ): DispatchResult {
    return {
      ok: false,
      agent: entry.req.agent,
      sessionId: "",
      error: { code, message },
      durationMs: queuedMs + workMs,
      queuedMs,
    };
  }

  return {
    async dispatch(req: DispatchRequest): Promise<DispatchResult> {
      const registry = await readAgents(opts.workspace);
      if (!registry[req.agent]) {
        return {
          ok: false, agent: req.agent, sessionId: "",
          error: { code: "UNKNOWN_AGENT", message: `agent "${req.agent}" not in agents.json` },
          durationMs: 0, queuedMs: 0,
        };
      }

      const q = queues.get(req.agent) ?? [];
      if (q.length >= maxQueue) {
        return {
          ok: false, agent: req.agent, sessionId: "",
          error: { code: "WORKER_BUSY", message: `queue depth ${q.length} >= max ${maxQueue}` },
          durationMs: 0, queuedMs: 0,
        };
      }

      return new Promise<DispatchResult>((resolve) => {
        const entry: QueueEntry = { req, enqueuedAt: Date.now(), resolve };
        q.push(entry);
        queues.set(req.agent, q);
        void processNext(req.agent);
      });
    },
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run tests/dispatch-core.test.ts
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/dispatch/core.ts tests/dispatch-core.test.ts
git commit -m "feat(dispatch): core dispatcher with per-agent queue and timeouts"
```

---

## Task 5: Runner — spawn claude and parse stream-json

**Files:**
- Create: `src/orchestrator/dispatch/runner.ts`
- Test: `tests/runner.test.ts`

The runner calls `child_process.spawn`. Tests inject a fake spawn to avoid depending on the real `claude` CLI.

- [ ] **Step 1: Write failing test**

Create `tests/runner.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { Readable, Writable, PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunner, type SpawnFn } from "../src/orchestrator/dispatch/runner.js";
import { writeAgents } from "../src/orchestrator/state.js";

interface FakeChild extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  stdin: Writable;
  kill: () => void;
}

function makeFakeChild(lines: string[], exitCode = 0): FakeChild {
  const ee = new EventEmitter() as FakeChild;
  ee.stdout = new PassThrough();
  ee.stderr = new PassThrough();
  ee.stdin = new PassThrough();
  ee.kill = () => {};
  queueMicrotask(() => {
    for (const l of lines) ee.stdout.push(l + "\n");
    ee.stdout.push(null);
    ee.stderr.push(null);
    ee.emit("exit", exitCode, null);
  });
  return ee;
}

describe("runner", () => {
  let ws: string;

  beforeEach(async () => {
    ws = mkdtempSync(join(tmpdir(), "cc-run-"));
    await writeAgents(ws, {
      host: { name: "host", cwd: join(ws, "agents/host"),
              sessionId: null, createdAt: "t", lastActiveAt: null },
    });
  });

  it("first run: captures session_id from init, returns final result", async () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "new-sid" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } }),
      JSON.stringify({ type: "result", subtype: "success", result: "hello",
                       usage: { input_tokens: 3, output_tokens: 1 } }),
    ];
    const spawnFn: SpawnFn = () => makeFakeChild(lines) as never;
    const runner = createRunner({ spawn: spawnFn });
    const out = await runner.run({ agent: "host", payload: "hi", workspace: ws });
    expect(out.sessionId).toBe("new-sid");
    expect(out.result).toBe("hello");
    expect(out.tokenUsage).toEqual({ input: 3, output: 1 });
  });

  it("subsequent run: uses existing sessionId, passes --resume", async () => {
    await writeAgents(ws, {
      host: { name: "host", cwd: join(ws, "agents/host"),
              sessionId: "existing-sid", createdAt: "t", lastActiveAt: null },
    });
    let capturedArgs: string[] = [];
    const spawnFn: SpawnFn = (_cmd, args) => {
      capturedArgs = args;
      return makeFakeChild([
        JSON.stringify({ type: "result", subtype: "success", result: "done",
                         usage: { input_tokens: 1, output_tokens: 1 } }),
      ]) as never;
    };
    const runner = createRunner({ spawn: spawnFn });
    const out = await runner.run({ agent: "host", payload: "ping", workspace: ws });
    expect(capturedArgs).toContain("--resume");
    expect(capturedArgs).toContain("existing-sid");
    expect(out.sessionId).toBe("existing-sid");
    expect(out.result).toBe("done");
  });

  it("throws on non-zero exit with stderr content", async () => {
    const spawnFn: SpawnFn = () => {
      const ee = new EventEmitter() as FakeChild;
      ee.stdout = new PassThrough();
      ee.stderr = new PassThrough();
      ee.stdin = new PassThrough();
      ee.kill = () => {};
      queueMicrotask(() => {
        ee.stderr.push("boom\n");
        ee.stdout.push(null);
        ee.stderr.push(null);
        ee.emit("exit", 1, null);
      });
      return ee as never;
    };
    const runner = createRunner({ spawn: spawnFn });
    await expect(runner.run({ agent: "host", payload: "x", workspace: ws }))
      .rejects.toThrow(/boom/);
  });

  it("throws when no result message arrives", async () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "sid-1" }),
    ];
    const spawnFn: SpawnFn = () => makeFakeChild(lines) as never;
    const runner = createRunner({ spawn: spawnFn });
    await expect(runner.run({ agent: "host", payload: "x", workspace: ws }))
      .rejects.toThrow(/no result/i);
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run tests/runner.test.ts
```

Expected: 4 tests fail.

- [ ] **Step 3: Implement runner**

Create `src/orchestrator/dispatch/runner.ts`:

```ts
import { spawn as realSpawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { readAgents } from "../state.js";
import type { Runner, RunnerOutcome } from "./contract.js";

export type SpawnFn = (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess;

interface Options {
  spawn?: SpawnFn;
}

export function createRunner(opts: Options = {}): Runner {
  const spawn = opts.spawn ?? realSpawn;

  return {
    async run({ agent, payload, workspace }): Promise<RunnerOutcome> {
      const registry = await readAgents(workspace);
      const record = registry[agent];
      if (!record) throw new Error(`unknown agent: ${agent}`);

      const args = ["-p", payload, "--output-format", "stream-json", "--verbose"];
      if (record.sessionId) args.push("--resume", record.sessionId);
      if (record.model) args.push("--model", record.model);

      const child = spawn("claude", args, {
        cwd: record.cwd,
        env: { ...process.env, CLOSEDCLAW_WORKSPACE: workspace },
      });

      let sessionId = record.sessionId ?? "";
      let result: string | undefined;
      let usage: RunnerOutcome["tokenUsage"];
      const stderrChunks: string[] = [];

      const rl = createInterface({ input: child.stdout! });
      rl.on("line", (line) => {
        if (!line.trim()) return;
        const msg = parseLine(line);
        if (!msg) return;
        if (msg.type === "system" && msg.subtype === "init" && typeof msg.session_id === "string") {
          sessionId = msg.session_id;
        } else if (msg.type === "result" && typeof msg.result === "string") {
          result = msg.result;
          if (msg.usage?.input_tokens != null && msg.usage?.output_tokens != null) {
            usage = { input: msg.usage.input_tokens, output: msg.usage.output_tokens };
          }
        }
      });

      child.stderr!.on("data", (b: Buffer) => stderrChunks.push(b.toString()));

      const exitCode: number = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", (code) => resolve(code ?? 1));
      });

      if (exitCode !== 0) {
        throw new Error(`claude exited ${exitCode}: ${stderrChunks.join("").slice(-500)}`);
      }
      if (result === undefined) throw new Error("no result produced");
      if (!sessionId) throw new Error("no session_id captured");

      return { sessionId, result, tokenUsage: usage };
    },
  };
}

interface StreamMessage {
  type?: string;
  subtype?: string;
  session_id?: string;
  result?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function parseLine(line: string): StreamMessage | null {
  try { return JSON.parse(line) as StreamMessage; } catch { return null; }
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run tests/runner.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/dispatch/runner.ts tests/runner.test.ts
git commit -m "feat(dispatch): runner that spawns claude and parses stream-json"
```

---

## Task 6: Channel / Trigger interface types

**Files:**
- Create: `src/orchestrator/channels/index.ts`
- Create: `src/orchestrator/triggers/index.ts`

No tests — pure types.

- [ ] **Step 1: Create channels/index.ts**

```ts
import type { Application } from "express";

export interface ChannelRef {
  channel: string;
  conversationId: string;
  userId?: string;
  raw?: unknown;
}

export interface IngestBus {
  submit(ref: ChannelRef, text: string): Promise<void>;
}

export interface ChannelContext {
  app: Application;
  bus: IngestBus;
  config: Record<string, string>;
}

export interface Channel {
  name: string;
  start(ctx: ChannelContext): Promise<void>;
  stop(): Promise<void>;
  reply(ref: ChannelRef, text: string): Promise<void>;
}
```

- [ ] **Step 2: Create triggers/index.ts**

```ts
import type { Channel, ChannelRef, IngestBus } from "../channels/index.js";
import type { AgentRegistry } from "../state.js";

export interface CronSpec {
  id: string;
  schedule: string;
  agent: string;
  payload: string;
  reply_to: { channel: string; conversationId: string } | null;
  timeoutMs?: number;
}

export interface TriggerContext {
  bus: IngestBus;
  channels: Map<string, Channel>;
  registry: AgentRegistry;
  workspace: string;
}
// registry is exposed for triggers that need to iterate or validate known agents
// (e.g., future inbox-polling trigger that fans out to every agent).

export interface Trigger {
  name: string;
  start(ctx: TriggerContext): Promise<void>;
  stop(): Promise<void>;
}

export type { ChannelRef };
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator/channels/index.ts src/orchestrator/triggers/index.ts
git commit -m "feat(channels,triggers): interface definitions"
```

---

## Task 7: IngestBus — ingest → dispatch(host) → reply

**Files:**
- Create: `src/orchestrator/channels/bus.ts`
- Test: `tests/bus.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/bus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createIngestBus } from "../src/orchestrator/channels/bus.js";
import type { Channel, ChannelRef } from "../src/orchestrator/channels/index.js";
import type { Dispatcher } from "../src/orchestrator/dispatch/core.js";
import type { DispatchRequest, DispatchResult } from "../src/orchestrator/dispatch/contract.js";

function fakeDispatcher(result: DispatchResult): Dispatcher {
  return { dispatch: async (_: DispatchRequest) => result };
}

function fakeChannel(name: string): { channel: Channel; replies: { ref: ChannelRef; text: string }[] } {
  const replies: { ref: ChannelRef; text: string }[] = [];
  const channel: Channel = {
    name,
    start: async () => {},
    stop: async () => {},
    reply: async (ref, text) => { replies.push({ ref, text }); },
  };
  return { channel, replies };
}

describe("IngestBus", () => {
  it("dispatches to host and replies with the result text on success", async () => {
    const d = fakeDispatcher({
      ok: true, agent: "host", sessionId: "s", result: "answer",
      durationMs: 10, queuedMs: 0,
    });
    const { channel, replies } = fakeChannel("telegram");
    const bus = createIngestBus({ dispatcher: d, channels: new Map([["telegram", channel]]) });
    await bus.submit({ channel: "telegram", conversationId: "42" }, "hi");
    expect(replies).toHaveLength(1);
    expect(replies[0].text).toBe("answer");
  });

  it("replies with a structured error string on failure", async () => {
    const d = fakeDispatcher({
      ok: false, agent: "host", sessionId: "",
      error: { code: "WORKER_BUSY", message: "queue full" },
      durationMs: 0, queuedMs: 0,
    });
    const { channel, replies } = fakeChannel("telegram");
    const bus = createIngestBus({ dispatcher: d, channels: new Map([["telegram", channel]]) });
    await bus.submit({ channel: "telegram", conversationId: "42" }, "hi");
    expect(replies[0].text).toMatch(/WORKER_BUSY/);
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run tests/bus.test.ts
```

Expected: 2 fail.

- [ ] **Step 3: Implement bus**

Create `src/orchestrator/channels/bus.ts`:

```ts
import type { Channel, ChannelRef, IngestBus } from "./index.js";
import type { Dispatcher } from "../dispatch/core.js";

interface Options {
  dispatcher: Dispatcher;
  channels: Map<string, Channel>;
}

export function createIngestBus(opts: Options): IngestBus {
  return {
    async submit(ref: ChannelRef, text: string): Promise<void> {
      const channel = opts.channels.get(ref.channel);
      if (!channel) return;

      const res = await opts.dispatcher.dispatch({
        agent: "host",
        payload: text,
        origin: { kind: "channel", name: ref.channel },
      });

      const replyText = res.ok
        ? (res.result ?? "")
        : `dispatch failed: ${res.error?.code}: ${res.error?.message}`;

      await channel.reply(ref, replyText);
    },
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run tests/bus.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/channels/bus.ts tests/bus.test.ts
git commit -m "feat(channels): IngestBus routing to host and back to reply"
```

---

## Task 8: TelegramChannel — webhook mount + secret + reply

**Files:**
- Create: `src/orchestrator/channels/telegram.ts`
- Test: `tests/telegram.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/telegram.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { TelegramChannel } from "../src/orchestrator/channels/telegram.js";
import type { ChannelRef } from "../src/orchestrator/channels/index.js";

function startApp(): Promise<{ app: express.Express; server: Server; port: number }> {
  const app = express();
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ app, server, port });
    });
  });
}

describe("TelegramChannel", () => {
  let submitted: { ref: ChannelRef; text: string }[];
  let app: express.Express;
  let server: Server;
  let port: number;
  const secret = "test-secret";

  beforeEach(async () => {
    ({ app, server, port } = await startApp());
    submitted = [];
    const bus = { submit: async (ref: ChannelRef, text: string) => { submitted.push({ ref, text }); } };
    const channel = new TelegramChannel({
      fetcher: async () => new Response("{}"),
      secretOverride: secret,
    });
    await channel.start({ app, bus, config: { token: "bot-token", publicBaseUrl: "https://x.example" } });
  });

  afterEach(() => { server?.close(); });

  it("accepts a valid Telegram update and submits to the bus", async () => {
    const res = await fetch(`http://localhost:${port}/webhooks/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify({
        update_id: 1,
        message: { message_id: 10, from: { id: 7, is_bot: false, first_name: "u" },
                   chat: { id: 99, type: "private" }, text: "hi" },
      }),
    });
    expect(res.status).toBe(200);
    expect(submitted).toHaveLength(1);
    expect(submitted[0].text).toBe("hi");
    expect(submitted[0].ref.conversationId).toBe("99");
  });

  it("rejects a request with a missing or wrong secret token", async () => {
    const res = await fetch(`http://localhost:${port}/webhooks/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: 2 }),
    });
    expect(res.status).toBe(401);
    expect(submitted).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run tests/telegram.test.ts
```

Expected: 2 fail.

- [ ] **Step 3: Implement TelegramChannel**

Create `src/orchestrator/channels/telegram.ts`:

```ts
import express from "express";
import { fetch } from "undici";
import type { Channel, ChannelContext, ChannelRef } from "./index.js";

type Fetcher = typeof fetch;

interface Options {
  fetcher?: Fetcher;
  secretOverride?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: { message_id: number; chat: { id: number }; from?: { id: number }; text?: string };
}

export class TelegramChannel implements Channel {
  readonly name = "telegram";
  private secret = "";
  private token = "";
  private fetcher: Fetcher;

  constructor(private readonly opts: Options = {}) {
    this.fetcher = opts.fetcher ?? fetch;
  }

  async start(ctx: ChannelContext): Promise<void> {
    this.token = ctx.config.token ?? process.env.TELEGRAM_BOT_TOKEN ?? "";
    this.secret = this.opts.secretOverride
      ?? ctx.config.secret
      ?? process.env.TELEGRAM_WEBHOOK_SECRET
      ?? "";

    ctx.app.post("/webhooks/telegram", express.json(), async (req, res) => {
      if (req.header("x-telegram-bot-api-secret-token") !== this.secret) {
        res.status(401).json({ ok: false });
        return;
      }
      const body = req.body as TelegramUpdate;
      if (!body?.message?.text || !body.message.chat?.id) {
        res.json({ ok: true });
        return;
      }
      const ref: ChannelRef = {
        channel: "telegram",
        conversationId: String(body.message.chat.id),
        userId: body.message.from ? String(body.message.from.id) : undefined,
        raw: body,
      };
      res.json({ ok: true });
      ctx.bus.submit(ref, body.message.text).catch((err) => {
        console.error("telegram ingest failed:", err);
      });
    });

    if (ctx.config.publicBaseUrl && this.token) {
      await this.registerWebhook(ctx.config.publicBaseUrl);
    }
  }

  async stop(): Promise<void> {}

  async reply(ref: ChannelRef, text: string): Promise<void> {
    if (!this.token) return;
    await this.fetcher(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: Number(ref.conversationId), text }),
    });
  }

  private async registerWebhook(publicBaseUrl: string): Promise<void> {
    const url = new URL("/webhooks/telegram", publicBaseUrl).toString();
    await this.fetcher(`https://api.telegram.org/bot${this.token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, secret_token: this.secret }),
    });
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run tests/telegram.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/channels/telegram.ts tests/telegram.test.ts
git commit -m "feat(telegram): webhook channel with secret validation"
```

---

## Task 9: CronTrigger — YAML load + schedule + dispatch

**Files:**
- Create: `src/orchestrator/triggers/cron.ts`
- Test: `tests/cron.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/cron.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCronSpecs } from "../src/orchestrator/triggers/cron.js";

describe("loadCronSpecs", () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "cc-cron-"));
    mkdirSync(join(ws, "agents/backend-dev"), { recursive: true });
  });

  it("unions workspace-level and per-agent crons.yaml", async () => {
    writeFileSync(join(ws, "crons.yaml"), `
- id: sys-rotate
  schedule: "0 0 * * *"
  agent: host
  payload: rotate
  reply_to: null
    `);
    writeFileSync(join(ws, "agents/backend-dev/crons.yaml"), `
- id: be-dream
  schedule: "0 3 * * *"
  agent: backend-dev
  payload: dream
  reply_to: null
    `);
    const specs = await loadCronSpecs(ws);
    expect(specs.map(s => s.id).sort()).toEqual(["be-dream", "sys-rotate"]);
  });

  it("throws on duplicate id across files", async () => {
    writeFileSync(join(ws, "crons.yaml"), `
- id: dup
  schedule: "0 0 * * *"
  agent: host
  payload: x
  reply_to: null
    `);
    writeFileSync(join(ws, "agents/backend-dev/crons.yaml"), `
- id: dup
  schedule: "0 1 * * *"
  agent: backend-dev
  payload: y
  reply_to: null
    `);
    await expect(loadCronSpecs(ws)).rejects.toThrow(/duplicate/i);
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run tests/cron.test.ts
```

Expected: 2 fail.

- [ ] **Step 3: Implement CronTrigger**

Create `src/orchestrator/triggers/cron.ts`:

```ts
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import cron from "node-cron";
import type { Trigger, TriggerContext, CronSpec } from "./index.js";
import type { Dispatcher } from "../dispatch/core.js";

export async function loadCronSpecs(workspace: string): Promise<CronSpec[]> {
  const files = [join(workspace, "crons.yaml")];
  const agentsDir = join(workspace, "agents");
  try {
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) files.push(join(agentsDir, e.name, "crons.yaml"));
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const all: CronSpec[] = [];
  for (const f of files) {
    let raw: string;
    try {
      raw = await fs.readFile(f, "utf8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    const parsed = parseYaml(raw) as CronSpec[] | null;
    if (Array.isArray(parsed)) all.push(...parsed);
  }

  const ids = new Set<string>();
  for (const s of all) {
    if (ids.has(s.id)) throw new Error(`duplicate cron id: ${s.id}`);
    ids.add(s.id);
  }
  return all;
}

interface Options {
  dispatcher: Dispatcher;
  writeDream: (agent: string, payload: string, result: string) => Promise<void>;
  logLine: (line: object) => Promise<void>;
}

export function createCronTrigger(opts: Options): Trigger {
  const tasks: cron.ScheduledTask[] = [];

  return {
    name: "cron",

    async start(ctx: TriggerContext): Promise<void> {
      const specs = await loadCronSpecs(ctx.workspace);
      for (const spec of specs) {
        const task = cron.schedule(spec.schedule, async () => {
          const res = await opts.dispatcher.dispatch({
            agent: spec.agent,
            payload: spec.payload,
            timeoutMs: spec.timeoutMs,
            origin: { kind: "trigger", name: "cron" },
          });
          await opts.logLine({ cron_id: spec.id, agent: spec.agent, ok: res.ok, error: res.error });
          if (res.ok && spec.reply_to === null && res.result) {
            await opts.writeDream(spec.agent, spec.payload, res.result);
          } else if (res.ok && spec.reply_to && res.result) {
            const channel = ctx.channels.get(spec.reply_to.channel);
            if (channel) {
              await channel.reply({ channel: spec.reply_to.channel, conversationId: spec.reply_to.conversationId }, res.result);
            }
          } else if (!res.ok && spec.reply_to) {
            const channel = ctx.channels.get(spec.reply_to.channel);
            if (channel) {
              await channel.reply(
                { channel: spec.reply_to.channel, conversationId: spec.reply_to.conversationId },
                `cron ${spec.id} failed: ${res.error?.code}`,
              );
            }
          }
        });
        tasks.push(task);
      }
    },

    async stop(): Promise<void> {
      for (const t of tasks) t.stop();
      tasks.length = 0;
    },
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run tests/cron.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/triggers/cron.ts tests/cron.test.ts
git commit -m "feat(triggers): cron loader and scheduled dispatch"
```

---

## Task 10: hook subcommand — stdin JSON → system.log

**Files:**
- Create: `src/orchestrator/util/read-stream.ts` (shared helper used by `hook` and `dispatch`)
- Create: `src/commands/hook.ts`
- Test: `tests/hook-command.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/hook-command.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { runHook } from "../src/commands/hook.js";

describe("hook command", () => {
  let ws: string;
  beforeEach(() => { ws = mkdtempSync(join(tmpdir(), "cc-hook-")); });

  it("appends a JSON line containing event name and payload", async () => {
    const payload = { session_id: "sid", agent_id: "aid", tool_name: "Bash" };
    const stdin = Readable.from([JSON.stringify(payload)]);
    await runHook({ event: "PreToolUse", workspace: ws, stdin });
    const log = readFileSync(join(ws, "system.log"), "utf8").trim();
    const parsed = JSON.parse(log);
    expect(parsed.hook_event_name).toBe("PreToolUse");
    expect(parsed.session_id).toBe("sid");
    expect(parsed.tool_name).toBe("Bash");
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("does not throw when stdin is empty", async () => {
    const stdin = Readable.from([]);
    await runHook({ event: "Stop", workspace: ws, stdin });
    const log = readFileSync(join(ws, "system.log"), "utf8").trim();
    const parsed = JSON.parse(log);
    expect(parsed.hook_event_name).toBe("Stop");
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run tests/hook-command.test.ts
```

Expected: 2 fail.

- [ ] **Step 3a: Create the shared read-stream helper**

Create `src/orchestrator/util/read-stream.ts`:

```ts
import type { Readable } from "node:stream";

export async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}
```

- [ ] **Step 3b: Implement hook**

Create `src/commands/hook.ts`:

```ts
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { readAll } from "../orchestrator/util/read-stream.js";

interface RunHookArgs {
  event: string;
  workspace: string;
  stdin: Readable;
}

export async function runHook(args: RunHookArgs): Promise<void> {
  const raw = await readAll(args.stdin);
  let payload: Record<string, unknown> = {};
  if (raw.trim().length > 0) {
    try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { payload = { parse_error: raw.slice(0, 200) }; }
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    hook_event_name: args.event,
    ...payload,
  });
  await fs.mkdir(args.workspace, { recursive: true });
  await fs.appendFile(join(args.workspace, "system.log"), line + "\n");
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run tests/hook-command.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/util/read-stream.ts src/commands/hook.ts tests/hook-command.test.ts
git commit -m "feat(cli): hook subcommand appending JSONL telemetry"
```

---

## Task 11: dispatch subcommand — stdin payload → dispatch() → stdout

**Files:**
- Create: `src/commands/dispatch.ts`
- Test: `tests/dispatch-command.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/dispatch-command.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PassThrough, Readable } from "node:stream";
import { runDispatch } from "../src/commands/dispatch.js";
import type { Dispatcher } from "../src/orchestrator/dispatch/core.js";

function collect(stream: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

describe("dispatch command", () => {
  it("writes result to stdout and exits 0 on success", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const dispatcher: Dispatcher = { dispatch: async () => ({
      ok: true, agent: "backend-dev", sessionId: "s", result: "done",
      durationMs: 0, queuedMs: 0,
    }) };
    const exit = await runDispatch({
      agent: "backend-dev",
      stdin: Readable.from(["build a login API"]),
      stdout, stderr,
      dispatcher,
    });
    stdout.end();
    expect(exit).toBe(0);
    expect(await collect(stdout)).toBe("done");
  });

  it("writes error code to stderr and exits 1 on failure", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const dispatcher: Dispatcher = { dispatch: async () => ({
      ok: false, agent: "backend-dev", sessionId: "",
      error: { code: "WORKER_BUSY", message: "queue full" },
      durationMs: 0, queuedMs: 0,
    }) };
    const exit = await runDispatch({
      agent: "backend-dev",
      stdin: Readable.from(["x"]),
      stdout, stderr,
      dispatcher,
    });
    stderr.end();
    expect(exit).toBe(1);
    expect(await collect(stderr)).toMatch(/WORKER_BUSY/);
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run tests/dispatch-command.test.ts
```

Expected: 2 fail.

- [ ] **Step 3: Implement dispatch command**

Create `src/commands/dispatch.ts`:

```ts
import type { Readable, Writable } from "node:stream";
import type { Dispatcher } from "../orchestrator/dispatch/core.js";
import { readAll } from "../orchestrator/util/read-stream.js";

interface RunDispatchArgs {
  agent: string;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  dispatcher: Dispatcher;
  correlationId?: string;
}

export async function runDispatch(args: RunDispatchArgs): Promise<number> {
  const payload = await readAll(args.stdin);
  const result = await args.dispatcher.dispatch({
    agent: args.agent,
    payload,
    correlationId: args.correlationId,
    origin: { kind: "host-delegation", name: "host" },
  });

  if (result.ok) {
    args.stdout.write(result.result ?? "");
    return 0;
  }
  args.stderr.write(`${result.error?.code}: ${result.error?.message}\n`);
  return 1;
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run tests/dispatch-command.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/commands/dispatch.ts tests/dispatch-command.test.ts
git commit -m "feat(cli): dispatch subcommand for host Bash delegation"
```

---

## Task 12: Workspace templates

**Files:**
- Create: all of `templates/**`

- [ ] **Step 1: Create workspace templates**

```bash
mkdir -p templates/workspace
mkdir -p templates/agents/host/.claude
mkdir -p templates/agents/host/memory
mkdir -p templates/agents/backend-dev/.claude/agents
mkdir -p templates/agents/backend-dev/memory
mkdir -p templates/agents/backend-dev/dreams
mkdir -p templates/agents/frontend-dev/.claude/agents
mkdir -p templates/agents/frontend-dev/memory
mkdir -p templates/agents/frontend-dev/dreams
```

- [ ] **Step 2: Write each template file**

`templates/workspace/.env.example`:
```
PORT=3000
PUBLIC_BASE_URL=https://your-tunnel.example.com
TELEGRAM_BOT_TOKEN=1234567890:AAA-your-bot-token
```

`templates/workspace/agents.json`:
```json
{
  "host": {
    "name": "host",
    "cwd": "{{WORKSPACE}}/agents/host",
    "sessionId": null,
    "createdAt": "{{NOW}}",
    "lastActiveAt": null
  },
  "backend-dev": {
    "name": "backend-dev",
    "cwd": "{{WORKSPACE}}/agents/backend-dev",
    "sessionId": null,
    "createdAt": "{{NOW}}",
    "lastActiveAt": null
  },
  "frontend-dev": {
    "name": "frontend-dev",
    "cwd": "{{WORKSPACE}}/agents/frontend-dev",
    "sessionId": null,
    "createdAt": "{{NOW}}",
    "lastActiveAt": null
  }
}
```

`templates/workspace/crons.yaml`:
```yaml
- id: rotate-system-log
  schedule: "0 0 * * *"
  agent: host
  payload: |
    System task: check ./system.log size. If > 10 MB, rename to
    system.log.<date> and start fresh. Report what you did.
  reply_to: null
  timeoutMs: 120000
```

`templates/agents/host/CLAUDE.md`:
```md
# ClosedClaw Host

You are the router. Every user message arrives as your prompt. For each one:

1. Read the intent.
2. If it needs a specialist, delegate by running this Bash command:
       echo "<refined task>" | closedclaw dispatch <agent-name>
   `closedclaw` is on PATH; the active workspace is inherited automatically.
3. If the request is conversational, answer directly without delegating.
4. Write one JSON line to ./memory/routing.jsonl describing the decision.
5. Reply to the user with a 2-3 sentence summary of the outcome.

Available workers (exact names for `closedclaw dispatch`):
- backend-dev   — APIs, DB, server-side auth, Node/Express
- frontend-dev  — React, CSS, client state

When dispatch returns an error on stderr:
- WORKER_BUSY: tell the user the worker is busy; ask them to retry in ~30s.
- TIMEOUT: apologize; do not auto-retry.
- UNKNOWN_AGENT: you made a typo. List the real agents and try again.
- WORKER_CRASH: tell the user something went wrong; include the short error.
```

`templates/agents/host/crons.yaml`:
```yaml
[]
```

`templates/agents/host/.claude/settings.json`:
```json
{
  "hooks": {
    "SessionStart":     [{ "matcher": "*", "hooks": [{ "type": "command", "command": "closedclaw hook SessionStart" }] }],
    "SessionEnd":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "closedclaw hook SessionEnd" }] }],
    "UserPromptSubmit": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "closedclaw hook UserPromptSubmit" }] }],
    "SubagentStart":    [{ "matcher": "*", "hooks": [{ "type": "command", "command": "closedclaw hook SubagentStart" }] }],
    "SubagentStop":     [{ "matcher": "*", "hooks": [{ "type": "command", "command": "closedclaw hook SubagentStop" }] }],
    "Stop":             [{ "matcher": "*", "hooks": [{ "type": "command", "command": "closedclaw hook Stop" }] }]
  }
}
```

`templates/agents/backend-dev/CLAUDE.md`:
```md
# backend-dev

Senior backend engineer. Work in THIS directory's cwd as the codebase root.
- Always validate inputs.
- Follow conventions in ./routes and ./db.
- After writing code, run `npm test` and include the result in your reply.
- On ambiguity, ask one clarifying question before coding.
```

`templates/agents/backend-dev/crons.yaml`:
```yaml
- id: backend-nightly-dream
  schedule: "0 3 * * *"
  agent: backend-dev
  payload: |
    Dream: review today's activity in this workspace. Note smells,
    unfinished work, ideas for tomorrow. Save to ./dreams/<ISO-date>.md.
  reply_to: null
  timeoutMs: 600000
```

`templates/agents/backend-dev/.claude/settings.json` — identical to host's.

`templates/agents/backend-dev/.claude/agents/api-writer.md`:
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

`templates/agents/backend-dev/.claude/agents/migration-writer.md`:
```md
---
name: migration-writer
description: Use for writing or modifying SQL migrations and Prisma schema files. Does not touch route code.
tools: Read, Write, Edit, Grep, Glob, Bash
model: sonnet
---

You write one migration at a time. Each migration is reversible: provide both up and down.
Test locally with `npm run db:migrate` before reporting done.
```

`templates/agents/frontend-dev/CLAUDE.md`:
```md
# frontend-dev

Senior frontend engineer. Work in THIS directory's cwd as the codebase root.
- Write React components with TypeScript. Use functional components + hooks only.
- Use Tailwind for styling unless an existing file uses another convention.
- After changes, run `npm run type-check` and include the result in your reply.
```

`templates/agents/frontend-dev/crons.yaml`:
```yaml
[]
```

`templates/agents/frontend-dev/.claude/settings.json` — identical to host's.

- [ ] **Step 3: Commit**

```bash
git add templates/
git commit -m "feat(templates): workspace, host, backend-dev, frontend-dev scaffolds"
```

---

## Task 13: init command

**Files:**
- Create: `src/commands/init.ts`
- Test: `tests/init-command.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/init-command.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";

describe("init command", () => {
  let target: string;
  beforeEach(() => { target = join(mkdtempSync(join(tmpdir(), "cc-init-")), "ws"); });

  it("creates the workspace structure with all required files", async () => {
    await runInit({ workspace: target, force: false });
    expect(existsSync(join(target, "agents.json"))).toBe(true);
    expect(existsSync(join(target, "crons.yaml"))).toBe(true);
    expect(existsSync(join(target, ".env.example"))).toBe(true);
    expect(existsSync(join(target, "state/secrets.json"))).toBe(true);
    expect(existsSync(join(target, "agents/host/CLAUDE.md"))).toBe(true);
    expect(existsSync(join(target, "agents/host/.claude/settings.json"))).toBe(true);
    expect(existsSync(join(target, "agents/backend-dev/.claude/agents/api-writer.md"))).toBe(true);
  });

  it("substitutes workspace and timestamp placeholders in agents.json", async () => {
    await runInit({ workspace: target, force: false });
    const registry = JSON.parse(readFileSync(join(target, "agents.json"), "utf8"));
    expect(registry.host.cwd).toContain(target);
    expect(registry.host.createdAt).toMatch(/^\d{4}-/);
  });

  it("refuses to overwrite existing workspace without force", async () => {
    await runInit({ workspace: target, force: false });
    await expect(runInit({ workspace: target, force: false })).rejects.toThrow(/already exists/i);
  });

  it("allows overwriting with force", async () => {
    await runInit({ workspace: target, force: false });
    await runInit({ workspace: target, force: true });
    expect(existsSync(join(target, "agents.json"))).toBe(true);
  });

  it("generates a non-empty secrets.json with telegramWebhookSecret", async () => {
    await runInit({ workspace: target, force: false });
    const secrets = JSON.parse(readFileSync(join(target, "state/secrets.json"), "utf8"));
    expect(secrets.telegramWebhookSecret).toMatch(/^[a-f0-9]{32,}$/);
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run tests/init-command.test.ts
```

Expected: 5 fail.

- [ ] **Step 3: Implement init**

Create `src/commands/init.ts`:

```ts
import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface RunInitArgs {
  workspace: string;
  force: boolean;
  templatesDir?: string;
}

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function runInit(args: RunInitArgs): Promise<void> {
  const templates = args.templatesDir ?? join(PACKAGE_ROOT, "templates");

  const exists = await dirExists(args.workspace);
  if (exists && !args.force) {
    throw new Error(`workspace already exists at ${args.workspace} (use --force to overwrite)`);
  }

  await fs.mkdir(join(args.workspace, "state"), { recursive: true });
  await fs.mkdir(join(args.workspace, "agents"), { recursive: true });

  await copyDir(join(templates, "workspace"), args.workspace);
  await copyDir(join(templates, "agents"), join(args.workspace, "agents"));

  const agentsPath = join(args.workspace, "agents.json");
  const raw = await fs.readFile(agentsPath, "utf8");
  const now = new Date().toISOString();
  const wsForJson = args.workspace.replaceAll("\\", "/");
  const substituted = raw
    .replaceAll("{{WORKSPACE}}", wsForJson)
    .replaceAll("{{NOW}}", now);
  await fs.writeFile(agentsPath, substituted);

  const secrets = { telegramWebhookSecret: randomBytes(24).toString("hex") };
  await fs.writeFile(join(args.workspace, "state/secrets.json"), JSON.stringify(secrets, null, 2));
}

async function dirExists(p: string): Promise<boolean> {
  try { const s = await fs.stat(p); return s.isDirectory(); } catch { return false; }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const from = join(src, e.name);
    const to = join(dest, e.name);
    if (e.isDirectory()) await copyDir(from, to);
    else await fs.copyFile(from, to);
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run tests/init-command.test.ts
```

Expected: 5 passed. Tests resolve templates via `import.meta.url` from the source tree, so no prior build is required.

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.ts tests/init-command.test.ts
git commit -m "feat(cli): init command scaffolds workspace from templates"
```

---

## Task 14: server — wire bus, channels, triggers, signals

**Files:**
- Create: `src/orchestrator/server.ts`

This has no dedicated unit test; it's wiring. Covered by smoke tests in Task 19.

- [ ] **Step 1: Implement server**

Create `src/orchestrator/server.ts`:

```ts
import express from "express";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createServer, type Server as HttpServer } from "node:http";
import { config as loadEnv } from "dotenv";
import { readAgents } from "./state.js";
import { createDispatcher, type Dispatcher } from "./dispatch/core.js";
import { createRunner } from "./dispatch/runner.js";
import { createIngestBus } from "./channels/bus.js";
import { TelegramChannel } from "./channels/telegram.js";
import { createCronTrigger } from "./triggers/cron.js";
import type { Channel } from "./channels/index.js";

export interface ServerHandle {
  dispatcher: Dispatcher;
  stop(): Promise<void>;
}

export async function startServer(workspace: string): Promise<ServerHandle> {
  loadEnv({ path: join(workspace, ".env") });
  const port = Number(process.env.PORT ?? 3000);

  const secretsRaw = await fs.readFile(join(workspace, "state/secrets.json"), "utf8");
  const secrets = JSON.parse(secretsRaw) as { telegramWebhookSecret: string };

  const dispatcher = createDispatcher({ workspace, runner: createRunner() });
  const channels = new Map<string, Channel>();
  const telegram = new TelegramChannel({ secretOverride: secrets.telegramWebhookSecret });
  channels.set("telegram", telegram);

  const app = express();
  const bus = createIngestBus({ dispatcher, channels });

  await telegram.start({
    app,
    bus,
    config: {
      token: process.env.TELEGRAM_BOT_TOKEN ?? "",
      publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "",
    },
  });

  const cron = createCronTrigger({
    dispatcher,
    writeDream: async (agent, payload, result) => {
      const dir = join(workspace, "agents", agent, "dreams");
      await fs.mkdir(dir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      await fs.writeFile(join(dir, `${ts}.md`), `# ${ts}\n\n## Payload\n\n${payload}\n\n## Result\n\n${result}\n`);
    },
    logLine: async (obj) => {
      await fs.appendFile(
        join(workspace, "system.log"),
        JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n",
      );
    },
  });

  const registry = await readAgents(workspace);
  await cron.start({ bus, channels, registry, workspace });

  const httpServer: HttpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(port, resolve));

  const stop = async (): Promise<void> => {
    await cron.stop();
    await telegram.stop();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  const onSignal = async (): Promise<void> => { await stop(); process.exit(0); };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);

  return { dispatcher, stop };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/orchestrator/server.ts
git commit -m "feat(server): boot dispatcher, channels, cron; handle shutdown"
```

---

## Task 15: start, add-agent, status, doctor commands

**Files:**
- Create: `src/commands/start.ts`, `src/commands/add-agent.ts`, `src/commands/status.ts`, `src/commands/doctor.ts`

These are short. Grouped into one task for velocity.

- [ ] **Step 1: Create start.ts**

```ts
import { startServer } from "../orchestrator/server.js";

export async function runStart(args: { workspace: string }): Promise<void> {
  await startServer(args.workspace);
}
```

- [ ] **Step 2: Create add-agent.ts**

```ts
import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readAgents, writeAgents, type AgentRecord } from "../orchestrator/state.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function runAddAgent(args: { workspace: string; name: string; templatesDir?: string }): Promise<void> {
  const registry = await readAgents(args.workspace);
  if (registry[args.name]) throw new Error(`agent ${args.name} already exists`);

  const templates = args.templatesDir ?? join(PACKAGE_ROOT, "templates");
  const src = join(templates, "agents/backend-dev");
  const dest = join(args.workspace, "agents", args.name);
  await copyDir(src, dest);

  const record: AgentRecord = {
    name: args.name, cwd: dest, sessionId: null,
    createdAt: new Date().toISOString(), lastActiveAt: null,
  };
  await writeAgents(args.workspace, { ...registry, [args.name]: record });
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const from = join(src, e.name); const to = join(dest, e.name);
    if (e.isDirectory()) await copyDir(from, to);
    else await fs.copyFile(from, to);
  }
}
```

- [ ] **Step 3: Create status.ts**

```ts
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { readAgents } from "../orchestrator/state.js";

export async function runStatus(args: { workspace: string; out: NodeJS.WritableStream }): Promise<void> {
  const registry = await readAgents(args.workspace);
  args.out.write("Agents:\n");
  for (const [name, rec] of Object.entries(registry)) {
    args.out.write(`  ${name.padEnd(16)} session=${rec.sessionId ?? "<none>"} lastActive=${rec.lastActiveAt ?? "<never>"}\n`);
  }

  const logPath = join(args.workspace, "system.log");
  try {
    const raw = await fs.readFile(logPath, "utf8");
    const tail = raw.split("\n").slice(-10).join("\n");
    args.out.write("\nRecent telemetry (last 10 lines):\n");
    args.out.write(tail + "\n");
  } catch {
    args.out.write("\n(no system.log yet)\n");
  }
}
```

- [ ] **Step 4: Create doctor.ts**

```ts
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fetch } from "undici";

export interface DoctorReport {
  passed: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

export async function runDoctor(args: { workspace: string }): Promise<DoctorReport> {
  const checks: DoctorReport["checks"] = [];

  checks.push(await checkWorkspaceExists(args.workspace));
  checks.push(await checkAgentsJson(args.workspace));
  checks.push(await checkEnv(args.workspace));
  checks.push(await checkBinary("claude"));
  checks.push(await checkBinary("closedclaw"));
  checks.push(await checkTunnel(args.workspace));

  return { passed: checks.every(c => c.ok), checks };
}

async function checkWorkspaceExists(ws: string) {
  try { await fs.stat(ws); return { name: "workspace exists", ok: true, detail: ws }; }
  catch { return { name: "workspace exists", ok: false, detail: `missing: ${ws}` }; }
}

async function checkAgentsJson(ws: string) {
  try {
    const raw = await fs.readFile(join(ws, "agents.json"), "utf8");
    const parsed = JSON.parse(raw);
    const count = Object.keys(parsed).length;
    return { name: "agents.json readable", ok: count > 0, detail: `${count} agents` };
  } catch (err: unknown) {
    return { name: "agents.json readable", ok: false, detail: String(err) };
  }
}

async function checkEnv(ws: string) {
  try {
    await fs.access(join(ws, ".env"));
    const tokenSet = !!process.env.TELEGRAM_BOT_TOKEN;
    return { name: ".env present, token set", ok: tokenSet, detail: tokenSet ? "ok" : "TELEGRAM_BOT_TOKEN missing" };
  } catch {
    return { name: ".env present, token set", ok: false, detail: ".env missing" };
  }
}

async function checkBinary(bin: string): Promise<DoctorReport["checks"][number]> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"], { stdio: "ignore" });
    child.on("error", () => resolve({ name: `${bin} on PATH`, ok: false, detail: "not found" }));
    child.on("exit", (code) => resolve({ name: `${bin} on PATH`, ok: code === 0, detail: code === 0 ? "ok" : `exited ${code}` }));
  });
}

async function checkTunnel(_ws: string): Promise<DoctorReport["checks"][number]> {
  const url = process.env.PUBLIC_BASE_URL;
  if (!url) return { name: "PUBLIC_BASE_URL reachable", ok: false, detail: "PUBLIC_BASE_URL unset" };
  try {
    const res = await fetch(url, { method: "HEAD" });
    return { name: "PUBLIC_BASE_URL reachable", ok: res.status < 500, detail: `HTTP ${res.status}` };
  } catch (err: unknown) {
    return { name: "PUBLIC_BASE_URL reachable", ok: false, detail: String(err) };
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/start.ts src/commands/add-agent.ts src/commands/status.ts src/commands/doctor.ts
git commit -m "feat(cli): start, add-agent, status, doctor commands"
```

---

## Task 16: cli.ts — the entrypoint binary

**Files:**
- Create: `src/cli.ts`

- [ ] **Step 1: Create cli.ts**

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { resolveWorkspace } from "./orchestrator/workspace.js";
import { runInit } from "./commands/init.js";
import { runStart } from "./commands/start.js";
import { runAddAgent } from "./commands/add-agent.js";
import { runStatus } from "./commands/status.js";
import { runDoctor } from "./commands/doctor.js";
import { runHook } from "./commands/hook.js";
import { runDispatch } from "./commands/dispatch.js";
import { createDispatcher } from "./orchestrator/dispatch/core.js";
import { createRunner } from "./orchestrator/dispatch/runner.js";

const program = new Command();
program.name("closedclaw").description("Claude-Code-native agent orchestrator").version("0.1.0");

program.command("init")
  .option("--dir <path>", "workspace directory")
  .option("--force", "overwrite existing workspace")
  .action(async (opts: { dir?: string; force?: boolean }) => {
    const ws = resolveWorkspace({ flag: opts.dir });
    await runInit({ workspace: ws, force: !!opts.force });
    console.log(`workspace initialized at ${ws}`);
  });

program.command("start")
  .option("--workspace <path>", "workspace directory")
  .action(async (opts: { workspace?: string }) => {
    const ws = resolveWorkspace({ flag: opts.workspace });
    await runStart({ workspace: ws });
    console.log(`closedclaw listening with workspace ${ws}`);
  });

program.command("add-agent <name>")
  .option("--workspace <path>")
  .action(async (name: string, opts: { workspace?: string }) => {
    const ws = resolveWorkspace({ flag: opts.workspace });
    await runAddAgent({ workspace: ws, name });
    console.log(`added agent ${name}`);
  });

program.command("status")
  .option("--workspace <path>")
  .action(async (opts: { workspace?: string }) => {
    const ws = resolveWorkspace({ flag: opts.workspace });
    await runStatus({ workspace: ws, out: process.stdout });
  });

program.command("doctor")
  .option("--workspace <path>")
  .action(async (opts: { workspace?: string }) => {
    const ws = resolveWorkspace({ flag: opts.workspace });
    const report = await runDoctor({ workspace: ws });
    for (const c of report.checks) {
      const tag = c.ok ? "PASS" : "FAIL";
      console.log(`[${tag}] ${c.name}: ${c.detail}`);
    }
    process.exit(report.passed ? 0 : 1);
  });

program.command("hook <event>", { hidden: true })
  .action(async (event: string) => {
    const ws = resolveWorkspace({});
    await runHook({ event, workspace: ws, stdin: process.stdin });
  });

program.command("dispatch <agent>", { hidden: true })
  .action(async (agent: string) => {
    const ws = resolveWorkspace({});
    const dispatcher = createDispatcher({ workspace: ws, runner: createRunner() });
    const code = await runDispatch({
      agent, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, dispatcher,
    });
    process.exit(code);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 2: Build and verify bin resolves**

```bash
npm run build
node dist/cli.js --help
```

Expected output lists `init`, `start`, `add-agent`, `status`, `doctor` (hook and dispatch are hidden).

- [ ] **Step 3: Smoke test `init` locally**

```bash
rm -rf /tmp/cc-smoke
node dist/cli.js init --dir /tmp/cc-smoke
ls /tmp/cc-smoke
```

Expected: `agents.json`, `crons.yaml`, `.env.example`, `state/`, `agents/host`, `agents/backend-dev`, `agents/frontend-dev`.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): entrypoint wiring all subcommands"
```

---

## Task 17: Dockerfile + .dockerignore

**Files:**
- Create: `Dockerfile`, `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

```
node_modules/
dist/
.env
workspace/
tests/
docs/
.git/
.github/
*.log
coverage/
```

- [ ] **Step 2: Create Dockerfile**

```dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
COPY templates/ ./templates/
RUN npm run build

FROM node:20-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code

ARG UID=1000
ARG GID=1000
RUN groupadd -g ${GID} agent && useradd -u ${UID} -g ${GID} -m -s /bin/bash agent

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

Debian base is required because `@anthropic-ai/claude-code` ships glibc-linked native binaries that do not run on Alpine's musl libc.

- [ ] **Step 3: Build the image locally**

```bash
docker build -t closedclaw:local --build-arg UID=$(id -u) --build-arg GID=$(id -g) .
```

Expected: build completes without error.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: multi-stage Dockerfile with claude CLI baked in"
```

---

## Task 18: docker-compose.yml + README + root .env.example

**Files:**
- Create: `docker-compose.yml`, `README.md`, `.env.example`

- [ ] **Step 1: Create root .env.example**

`.env.example`:

```
TELEGRAM_BOT_TOKEN=
PUBLIC_BASE_URL=
CLOUDFLARE_TUNNEL_TOKEN=
UID=1000
GID=1000
```

This file is read by `docker-compose.yml` via `env_file: .env`. The operator copies it to `.env` and fills in values before `docker compose up`.

- [ ] **Step 2: Create docker-compose.yml**

```yaml
services:
  closedclaw:
    build:
      context: .
      args:
        UID: "${UID:-1000}"
        GID: "${GID:-1000}"
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

- [ ] **Step 3: Create README.md**

````md
# closedclaw

Claude-Code-native agent orchestrator. Route messages from channels (Telegram) and cron triggers to a persistent host Claude Code session that delegates to specialist worker sessions.

## Requirements

- Node.js >= 20
- `claude` CLI installed and logged in (`claude login`)

## Install

```
npm install -g closedclaw
closedclaw init
```

Edit `~/.closedclaw/.env`, then:

```
closedclaw doctor
closedclaw start
```

## Docker

```
claude login
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN, CLOUDFLARE_TUNNEL_TOKEN, PUBLIC_BASE_URL
docker compose up -d
docker compose exec closedclaw closedclaw init
docker compose restart closedclaw
```

## Workspace resolution

1. `--workspace <path>`
2. `CLOSEDCLAW_WORKSPACE`
3. `./workspace/` if present
4. `~/.closedclaw/`

## Commands

- `closedclaw init` — scaffold a workspace
- `closedclaw start` — run the orchestrator
- `closedclaw add-agent <name>` — scaffold a new worker
- `closedclaw status` — show agents + recent telemetry
- `closedclaw doctor` — diagnostics
````

- [ ] **Step 4: Commit**

```bash
git add .env.example docker-compose.yml README.md
git commit -m "docs: README, docker-compose with cloudflared sidecar, env example"
```

---

## Task 19: End-to-end smoke test procedure

**Files:**
- Create: `tests/smoke.md` (manual procedure, not a vitest test)

These tests require a real Telegram bot and `claude` CLI; they run manually.

- [ ] **Step 1: Create tests/smoke.md**

```md
# Smoke tests (manual)

## Prerequisites
- `claude` CLI installed, `claude login` completed on host.
- A Telegram bot token in `.env`.
- `cloudflared` tunnel pointing to your local port 3000 (or equivalent).

## S1 — init + doctor green
```
rm -rf ~/.closedclaw
npm run build
node dist/cli.js init
node dist/cli.js doctor
```
Expected: every check reports PASS.

## S2 — Telegram end-to-end
1. `node dist/cli.js start`
2. From Telegram, send: "I need an API for user signup."
3. Watch `~/.closedclaw/system.log` (`tail -f`).
4. Expect lines: `SessionStart` (host) → `UserPromptSubmit` → `SessionStart` (backend-dev, via Bash-delegation) → `Stop` (backend-dev) → `Stop` (host).
5. Bot replies in Telegram with a short summary.
6. `~/.closedclaw/agents.json` — `host.sessionId` and `backend-dev.sessionId` are non-null.

## S3 — cron dream
1. Edit `~/.closedclaw/agents/backend-dev/crons.yaml`: change schedule to `* * * * *`.
2. Restart.
3. Wait 60s.
4. Check `~/.closedclaw/agents/backend-dev/dreams/` for a new `.md` file.
5. Revert schedule.

## S4 — WORKER_BUSY
1. From Telegram, send 12 messages in ~2 seconds (e.g. "msg 1", "msg 2", …).
2. At least one reply should say the worker is busy — the host saw WORKER_BUSY and handled it.

## S5 — Docker parity
```
docker compose up -d
docker compose exec closedclaw closedclaw init
docker compose restart closedclaw
```
Repeat S2 through the Docker deployment.
```

- [ ] **Step 2: Commit**

```bash
git add tests/smoke.md
git commit -m "test: manual smoke test procedure"
```

- [ ] **Step 3: Run smoke tests S1 and S2 yourself.**

Confirm both pass before declaring v0 complete. If either fails, document the failure and fix before proceeding — do NOT mark v0 done with failing smoke tests.

---

## Task 20: Final polish and v0 tag

- [ ] **Step 1: Run the full test suite**

```bash
npm run build && npm test
```

Expected: all vitest tests pass. If any fail, fix before proceeding.

- [ ] **Step 2: Run doctor on a clean workspace**

```bash
rm -rf /tmp/cc-final
node dist/cli.js --workspace /tmp/cc-final init
# Create a minimal .env in /tmp/cc-final
node dist/cli.js --workspace /tmp/cc-final doctor
```

Expected: all checks PASS except possibly `PUBLIC_BASE_URL reachable` if not set.

- [ ] **Step 3: Tag v0**

```bash
git tag -a v0.1.0 -m "closedclaw v0.1.0 — initial release"
```

---

## Self-review (spec coverage)

Mapping spec sections to tasks:

| Spec section | Implementing task(s) |
|---|---|
| §1 Thesis, §2 Non-goals | (design only) |
| §3 Architecture | Tasks 14, 16 wire it |
| §4 Distribution model | Task 16 (cli.ts), Task 17 (Dockerfile), Task 18 (compose) |
| §5 File layout | Task 0 (package skeleton), Task 12 (templates) |
| §6.1 DispatchRequest/Result | Task 3 |
| §6.2 Channel | Task 6 |
| §6.3 Trigger | Task 6 |
| §6.4 AgentRecord | Task 2 |
| §6.5 CronSpec | Tasks 6, 9 |
| §7.1 Telegram flow | Tasks 7, 8 |
| §7.2 Cron flow | Task 9 |
| §7.3 Hooks telemetry | Task 10 |
| §8 Failure modes | Tasks 4 (UNKNOWN_AGENT/BUSY/TIMEOUT/CRASH), 8 (401), 2 (corruption) |
| §9 File formats | Task 12 (templates), Task 13 (init substitution) |
| §10 CLI surface | Tasks 13–16 |
| §11 Bash → MCP path | (documented, not implemented in v0) |
| §12 Deployment | Tasks 17, 18 |
| §13 v0 checklist | All tasks |
| §14 Deferred | (not implemented) |

**No gaps.** MCP transport (§11) is explicitly deferred.

**Placeholder scan:** No "TODO", "TBD", or vague "add error handling" language in the plan.

**Type consistency:** `DispatchRequest`, `DispatchResult`, `Runner`, `Dispatcher`, `Channel`, `ChannelRef`, `IngestBus`, `Trigger`, `TriggerContext`, `AgentRecord`, `AgentRegistry`, `CronSpec` — all defined in one place and used consistently.

**Code style compliance:** No subjective/state-change comments in any snippet. No spam comments. A few inline comments explaining WHY in runner/core are acceptable under the rules. All code uses TS + ESM + `NodeNext` with `.js` imports.
