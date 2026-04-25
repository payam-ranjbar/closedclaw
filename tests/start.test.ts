import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { runStart, type SpawnedChild } from "../src/commands/start.js";
import {
  pidFilePath,
  startLockPath,
  writePidFile,
} from "../src/orchestrator/daemon.js";

function collect(stream: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

class FakeChild extends EventEmitter implements SpawnedChild {
  constructor(public pid: number) { super(); }
  unref(): void { /* no-op */ }
  once(event: "exit", cb: (code: number | null) => void): this {
    return super.once(event, cb) as this;
  }
}

describe("start command", () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "cc-start-"));
    mkdirSync(join(ws, "logs"), { recursive: true });
  });

  it("idempotent: returns 0 with 'already running' when daemon is up", async () => {
    writePidFile(ws, process.pid);
    const out = new PassThrough(), err = new PassThrough();
    let spawnCalls = 0;
    const spawner = (): FakeChild => { spawnCalls++; return new FakeChild(99999); };
    const code = await runStart({
      workspace: ws, foreground: false, out, err, spawner,
    });
    out.end(); err.end();
    expect(code).toBe(0);
    expect(spawnCalls).toBe(0);
    expect(await collect(out)).toContain(`closedclaw already running (pid ${process.pid})`);
  });

  it("happy path: stale PID cleaned, child stays alive past stabilization, returns 0", async () => {
    writePidFile(ws, 2 ** 30);
    const out = new PassThrough(), err = new PassThrough();
    const child = new FakeChild(54321);
    const spawner = (): FakeChild => child;
    const code = await runStart({
      workspace: ws, foreground: false, out, err, spawner,
      stabilizeMs: 50,
    });
    out.end(); err.end();
    expect(code).toBe(0);
    expect(existsSync(startLockPath(ws))).toBe(false);
    expect(existsSync(pidFilePath(ws))).toBe(true);
    expect(await collect(out)).toContain("closedclaw running (pid 54321)");
  });

  it("stabilization failure: child exits early, PID cleared, returns 1", async () => {
    const out = new PassThrough(), err = new PassThrough();
    writeFileSync(join(ws, "logs", "daemon.err"), "fake-error: bad config\n");
    const child = new FakeChild(54321);
    const spawner = (): FakeChild => child;
    const promise = runStart({
      workspace: ws, foreground: false, out, err, spawner,
      stabilizeMs: 200,
    });
    setTimeout(() => child.emit("exit", 7), 10);
    const code = await promise;
    out.end(); err.end();
    expect(code).toBe(1);
    expect(existsSync(pidFilePath(ws))).toBe(false);
    const errText = await collect(err);
    expect(errText).toContain("fake-error: bad config");
    expect(errText).toContain("closedclaw failed to start (exit code 7)");
  });

  it("race defense: stale start lock is recovered and second acquire succeeds", async () => {
    mkdirSync(join(ws, "state"), { recursive: true });
    writeFileSync(startLockPath(ws), "stale\n");
    const out = new PassThrough(), err = new PassThrough();
    const child = new FakeChild(11111);
    const spawner = (): FakeChild => child;
    const code = await runStart({
      workspace: ws, foreground: false, out, err, spawner,
      stabilizeMs: 50,
    });
    out.end(); err.end();
    expect(code).toBe(0);
    expect(existsSync(startLockPath(ws))).toBe(false);
  });
});
