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
