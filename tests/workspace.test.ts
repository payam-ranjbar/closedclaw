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
