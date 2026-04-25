import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pidFilePath,
  readPidFile,
  writePidFile,
  clearPidFile,
  startLockPath,
  acquireStartLock,
  releaseStartLock,
  isDaemonAlive,
} from "../src/orchestrator/daemon.js";

describe("daemon: PID file", () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "cc-daemon-"));
  });

  it("pidFilePath resolves under state/", () => {
    expect(pidFilePath(ws)).toBe(join(ws, "state", "closedclaw.pid"));
  });

  it("readPidFile returns null when missing", () => {
    expect(readPidFile(ws)).toBeNull();
  });

  it("readPidFile returns null when empty", () => {
    mkdirSync(join(ws, "state"), { recursive: true });
    writeFileSync(pidFilePath(ws), "");
    expect(readPidFile(ws)).toBeNull();
  });

  it("readPidFile returns null when non-numeric", () => {
    mkdirSync(join(ws, "state"), { recursive: true });
    writeFileSync(pidFilePath(ws), "not-a-pid\n");
    expect(readPidFile(ws)).toBeNull();
  });

  it("writePidFile then readPidFile round-trips", () => {
    writePidFile(ws, 12345);
    expect(readPidFile(ws)).toEqual({ pid: 12345 });
  });

  it("clearPidFile removes the file", () => {
    writePidFile(ws, 12345);
    expect(existsSync(pidFilePath(ws))).toBe(true);
    clearPidFile(ws);
    expect(existsSync(pidFilePath(ws))).toBe(false);
  });

  it("clearPidFile is idempotent on missing", () => {
    expect(() => clearPidFile(ws)).not.toThrow();
  });
});

describe("daemon: start lock", () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "cc-daemon-"));
  });

  it("startLockPath resolves under state/", () => {
    expect(startLockPath(ws)).toBe(join(ws, "state", "closedclaw.start.lock"));
  });

  it("acquireStartLock succeeds on first call", () => {
    expect(() => acquireStartLock(ws)).not.toThrow();
    expect(existsSync(startLockPath(ws))).toBe(true);
  });

  it("acquireStartLock throws EEXIST on second call", () => {
    acquireStartLock(ws);
    let caught: NodeJS.ErrnoException | null = null;
    try { acquireStartLock(ws); } catch (e) { caught = e as NodeJS.ErrnoException; }
    expect(caught?.code).toBe("EEXIST");
  });

  it("releaseStartLock removes the lock", () => {
    acquireStartLock(ws);
    releaseStartLock(ws);
    expect(existsSync(startLockPath(ws))).toBe(false);
  });

  it("releaseStartLock is idempotent on missing", () => {
    expect(() => releaseStartLock(ws)).not.toThrow();
  });
});

describe("daemon: isDaemonAlive", () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "cc-daemon-"));
  });

  it("returns running:false when no PID file", () => {
    expect(isDaemonAlive(ws)).toEqual({ running: false });
  });

  it("returns running:true with our own pid", () => {
    writePidFile(ws, process.pid);
    expect(isDaemonAlive(ws)).toEqual({ running: true, pid: process.pid });
  });

  it("returns running:false when pid is dead", () => {
    writePidFile(ws, 2 ** 30);
    expect(isDaemonAlive(ws)).toEqual({ running: false });
  });

  it("treats malformed pid file as not running", () => {
    mkdirSync(join(ws, "state"), { recursive: true });
    writeFileSync(pidFilePath(ws), "garbage");
    expect(isDaemonAlive(ws)).toEqual({ running: false });
  });
});
