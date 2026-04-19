import { readAgents, updateAgent } from "../state.js";
import type {
  DispatchRequest,
  DispatchResult,
  DispatchErrorCode,
  Runner,
} from "./contract.js";
import { promises as fs } from "node:fs";
import { join as pathJoin } from "node:path";

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

async function logQueueEvent(workspace: string, event: object): Promise<void> {
  try {
    const dir = pathJoin(workspace, "state");
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(
      pathJoin(dir, "queue.log"),
      JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n",
    );
  } catch {
    // queue.log is best-effort; never let a log failure kill a dispatch.
  }
}

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
    void logQueueEvent(opts.workspace, {
      event: "dequeue",
      agent,
      correlationId: entry.req.correlationId,
    });
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
        void logQueueEvent(opts.workspace, {
          event: "enqueue",
          agent: req.agent,
          correlationId: req.correlationId,
          depth: q.length,
        });
        void processNext(req.agent);
      });
    },
  };
}
