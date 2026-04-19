import { describe, it, expect } from "vitest";
import { PassThrough, Readable } from "node:stream";
import { runDispatch } from "../src/commands/dispatch.js";
import type { Dispatcher } from "../src/orchestrator/dispatch/core.js";

function collect(stream: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

describe("dispatch command", () => {
  it("writes result to stdout and exits 0 on success", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const dispatcher: Dispatcher = { dispatch: async () => ({
      ok: true, agent: "backend-dev", sessionId: "s", result: "done",
      durationMs: 0, queuedMs: 0,
    }) };
    const exit = await runDispatch({
      agent: "backend-dev",
      stdin: Readable.from(["build a login API"]),
      stdout, stderr,
      dispatcher,
    });
    stdout.end();
    expect(exit).toBe(0);
    expect(await collect(stdout)).toBe("done");
  });

  it("writes error code to stderr and exits 1 on failure", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const dispatcher: Dispatcher = { dispatch: async () => ({
      ok: false, agent: "backend-dev", sessionId: "",
      error: { code: "WORKER_BUSY", message: "queue full" },
      durationMs: 0, queuedMs: 0,
    }) };
    const exit = await runDispatch({
      agent: "backend-dev",
      stdin: Readable.from(["x"]),
      stdout, stderr,
      dispatcher,
    });
    stderr.end();
    expect(exit).toBe(1);
    expect(await collect(stderr)).toMatch(/WORKER_BUSY/);
  });
});
