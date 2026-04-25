import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { writePidFile } from "../src/orchestrator/daemon.js";
import { runStatus } from "../src/commands/status.js";

function collect(stream: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

describe("status command", () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "cc-status-"));
  });

  it("first line is 'closedclaw not running' when no daemon", async () => {
    const out = new PassThrough();
    await runStatus({ workspace: ws, out });
    out.end();
    const text = await collect(out);
    expect(text.split("\n")[0]).toBe("closedclaw not running");
  });

  it("first line shows running pid when daemon is up", async () => {
    writePidFile(ws, process.pid);
    const out = new PassThrough();
    await runStatus({ workspace: ws, out });
    out.end();
    const text = await collect(out);
    expect(text.split("\n")[0]).toBe(`closedclaw running (pid ${process.pid})`);
  });
});
