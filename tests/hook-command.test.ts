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
