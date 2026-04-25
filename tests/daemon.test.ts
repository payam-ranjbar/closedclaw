import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pidFilePath,
  readPidFile,
  writePidFile,
  clearPidFile,
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
