import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { writePidFile, pidFilePath } from "../src/orchestrator/daemon.js";
import { runStop } from "../src/commands/stop.js";

function collect(stream: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

interface FakeClock {
  now(): number;
  sleep(ms: number): Promise<void>;
  advance(ms: number): void;
}
function makeClock(): FakeClock {
  let t = 0;
  const waiters: { until: number; resolve: () => void }[] = [];
  return {
    now: () => t,
    sleep: (ms) => ms === 0 ? Promise.resolve() : new Promise<void>((resolve) => waiters.push({ until: t + ms, resolve })),
    advance(ms) {
      t += ms;
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].until <= t) { waiters[i].resolve(); waiters.splice(i, 1); }
      }
    },
  };
}

describe("stop command", () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "cc-stop-"));
  });

  it("returns 0 with 'not running' when no PID file", async () => {
    const out = new PassThrough(), err = new PassThrough();
    const code = await runStop({ workspace: ws, force: false, out, err });
    out.end(); err.end();
    expect(code).toBe(0);
    expect(await collect(out)).toContain("closedclaw not running");
  });

  it("clears stale PID file and returns 0", async () => {
    writePidFile(ws, 2 ** 30);
    const out = new PassThrough(), err = new PassThrough();
    const code = await runStop({ workspace: ws, force: false, out, err });
    out.end(); err.end();
    expect(code).toBe(0);
    expect(existsSync(pidFilePath(ws))).toBe(false);
  });

  it("happy path: sends SIGTERM, polls, exits 0 when process dies", async () => {
    const livePid = process.pid;
    writePidFile(ws, livePid);
    const out = new PassThrough(), err = new PassThrough();
    const clock = makeClock();
    let alive = true;
    const signaller = (_pid: number, signal: NodeJS.Signals | 0) => {
      if (signal === "SIGTERM") { alive = false; return; }
      if (signal === 0) {
        if (!alive) { const e = new Error("ESRCH") as NodeJS.ErrnoException; e.code = "ESRCH"; throw e; }
        return;
      }
    };
    const promise = runStop({ workspace: ws, force: false, out, err, signaller, clock });
    await clock.sleep(0);
    clock.advance(100);
    const code = await promise;
    out.end(); err.end();
    expect(code).toBe(0);
    expect(await collect(out)).toContain(`stopped (was pid ${livePid})`);
    expect(existsSync(pidFilePath(ws))).toBe(false);
  });

  it("times out after 5s without --force and returns 1", async () => {
    writePidFile(ws, process.pid);
    const out = new PassThrough(), err = new PassThrough();
    const clock = makeClock();
    const signaller = (_pid: number, _signal: NodeJS.Signals | 0) => { /* always alive */ };
    const promise = runStop({ workspace: ws, force: false, out, err, signaller, clock });
    for (let i = 0; i < 60; i++) { await clock.sleep(0); clock.advance(100); }
    const code = await promise;
    out.end(); err.end();
    expect(code).toBe(1);
    expect(await collect(err)).toMatch(/did not exit within 5s/);
  });

  it("--force escalates to SIGKILL and exits 0", async () => {
    writePidFile(ws, process.pid);
    const out = new PassThrough(), err = new PassThrough();
    const clock = makeClock();
    let alive = true;
    let killed = false;
    const signaller = (_pid: number, signal: NodeJS.Signals | 0) => {
      if (signal === "SIGKILL") { alive = false; killed = true; return; }
      if (signal === 0 && !alive) {
        const e = new Error("ESRCH") as NodeJS.ErrnoException; e.code = "ESRCH"; throw e;
      }
    };
    const promise = runStop({ workspace: ws, force: true, out, err, signaller, clock });
    for (let i = 0; i < 60; i++) { await clock.sleep(0); clock.advance(100); }
    const code = await promise;
    out.end(); err.end();
    expect(killed).toBe(true);
    expect(code).toBe(0);
    expect(await collect(out)).toContain("force-stopped");
  });
});
