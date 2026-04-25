import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
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
});
