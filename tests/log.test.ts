import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, appendFileSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { runLog } from "../src/commands/log.js";

function collect(stream: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

describe("log command (one-shot)", () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "cc-log-"));
  });

  it("prints '(no system.log yet)' when missing and returns 0", async () => {
    const out = new PassThrough(), err = new PassThrough();
    const code = await runLog({ workspace: ws, lines: 50, follow: false, out, err });
    out.end(); err.end();
    expect(code).toBe(0);
    expect(await collect(out)).toContain("(no system.log yet)");
  });

  it("returns last N lines from a long file", async () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line-${i + 1}`).join("\n");
    writeFileSync(join(ws, "system.log"), lines + "\n");
    const out = new PassThrough(), err = new PassThrough();
    const code = await runLog({ workspace: ws, lines: 3, follow: false, out, err });
    out.end(); err.end();
    expect(code).toBe(0);
    expect(await collect(out)).toBe("line-998\nline-999\nline-1000\n");
  });

  it("returns full file when N exceeds line count", async () => {
    writeFileSync(join(ws, "system.log"), "a\nb\nc\n");
    const out = new PassThrough(), err = new PassThrough();
    const code = await runLog({ workspace: ws, lines: 50, follow: false, out, err });
    out.end(); err.end();
    expect(code).toBe(0);
    expect(await collect(out)).toBe("a\nb\nc\n");
  });

  it("handles empty file", async () => {
    writeFileSync(join(ws, "system.log"), "");
    const out = new PassThrough(), err = new PassThrough();
    const code = await runLog({ workspace: ws, lines: 50, follow: false, out, err });
    out.end(); err.end();
    expect(code).toBe(0);
    expect(await collect(out)).toBe("");
  });

  it("handles a line longer than the read chunk", async () => {
    const longLine = "x".repeat(5000);
    writeFileSync(join(ws, "system.log"), `first\n${longLine}\nlast\n`);
    const out = new PassThrough(), err = new PassThrough();
    const code = await runLog({ workspace: ws, lines: 2, follow: false, out, err });
    out.end(); err.end();
    expect(code).toBe(0);
    expect(await collect(out)).toBe(`${longLine}\nlast\n`);
  });
});

describe("log command (--follow)", () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "cc-log-follow-"));
  });

  it("emits new content appended after watch begins", async () => {
    const path = join(ws, "system.log");
    writeFileSync(path, "initial\n");
    const out = new PassThrough(), err = new PassThrough();
    const ac = new AbortController();
    const promise = runLog({
      workspace: ws, lines: 10, follow: true,
      out, err, signal: ac.signal,
      pollIntervalMs: 50,
    });
    await new Promise((r) => setTimeout(r, 100));
    appendFileSync(path, "appended\n");
    await new Promise((r) => setTimeout(r, 250));
    ac.abort();
    const code = await promise;
    out.end(); err.end();
    expect(code).toBe(0);
    expect(await collect(out)).toContain("appended");
  });

  it("handles truncation by resetting offset", async () => {
    const path = join(ws, "system.log");
    writeFileSync(path, "first\nsecond\n");
    const out = new PassThrough(), err = new PassThrough();
    const ac = new AbortController();
    const promise = runLog({
      workspace: ws, lines: 10, follow: true,
      out, err, signal: ac.signal,
      pollIntervalMs: 50,
    });
    await new Promise((r) => setTimeout(r, 100));
    truncateSync(path, 0);
    await new Promise((r) => setTimeout(r, 100));
    appendFileSync(path, "after-truncate\n");
    await new Promise((r) => setTimeout(r, 250));
    ac.abort();
    const code = await promise;
    out.end(); err.end();
    expect(code).toBe(0);
    expect(await collect(out)).toContain("after-truncate");
  });
});
