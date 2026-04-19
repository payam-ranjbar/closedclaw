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
