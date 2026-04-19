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
