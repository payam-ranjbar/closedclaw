#!/usr/bin/env node
import { Command } from "commander";
import { config as loadEnv } from "dotenv";
import { join } from "node:path";
import { resolveWorkspace } from "./orchestrator/workspace.js";
import { runInit } from "./commands/init.js";
import { runStart } from "./commands/start.js";
import { runAddAgent } from "./commands/add-agent.js";
import { runStatus } from "./commands/status.js";
import { runLog } from "./commands/log.js";
import { runStop } from "./commands/stop.js";
import { runDoctor } from "./commands/doctor.js";
import { runHook } from "./commands/hook.js";
import { runDispatch } from "./commands/dispatch.js";
import { createDispatcher } from "./orchestrator/dispatch/core.js";
import { createRunner } from "./orchestrator/dispatch/runner.js";

const program = new Command();
program.name("closedclaw").description("Claude-Code-native agent orchestrator").version("0.1.0");

program.command("init")
  .option("--dir <path>", "workspace directory")
  .option("--force", "overwrite existing workspace")
  .action(async (opts: { dir?: string; force?: boolean }) => {
    const ws = resolveWorkspace({ flag: opts.dir });
    await runInit({ workspace: ws, force: !!opts.force });
    console.log(`workspace initialized at ${ws}`);
  });

program.command("start")
  .option("--workspace <path>", "workspace directory")
  .action(async (opts: { workspace?: string }) => {
    const ws = resolveWorkspace({ flag: opts.workspace });
    await runStart({ workspace: ws });
    console.log(`closedclaw listening with workspace ${ws}`);
  });

program.command("add-agent <name>")
  .option("--workspace <path>")
  .action(async (name: string, opts: { workspace?: string }) => {
    const ws = resolveWorkspace({ flag: opts.workspace });
    await runAddAgent({ workspace: ws, name });
    console.log(`added agent ${name}`);
  });

program.command("status")
  .option("--workspace <path>")
  .action(async (opts: { workspace?: string }) => {
    const ws = resolveWorkspace({ flag: opts.workspace });
    await runStatus({ workspace: ws, out: process.stdout });
  });

program.command("stop")
  .option("--workspace <path>")
  .option("--force", "send SIGKILL after the SIGTERM grace period")
  .action(async (opts: { workspace?: string; force?: boolean }) => {
    const ws = resolveWorkspace({ flag: opts.workspace });
    const code = await runStop({
      workspace: ws, force: !!opts.force,
      out: process.stdout, err: process.stderr,
    });
    process.exit(code);
  });

program.command("log")
  .option("--workspace <path>")
  .option("-f, --follow", "stream new lines as they are appended")
  .option("-n, --lines <n>", "number of lines to print initially", (v) => parseInt(v, 10), 50)
  .action(async (opts: { workspace?: string; follow?: boolean; lines: number }) => {
    const ws = resolveWorkspace({ flag: opts.workspace });
    const ac = new AbortController();
    const onSig = (): void => ac.abort();
    process.once("SIGINT", onSig);
    const code = await runLog({
      workspace: ws, lines: opts.lines, follow: !!opts.follow,
      out: process.stdout, err: process.stderr, signal: ac.signal,
    });
    process.off("SIGINT", onSig);
    process.exit(code);
  });

program.command("doctor")
  .option("--workspace <path>")
  .action(async (opts: { workspace?: string }) => {
    const ws = resolveWorkspace({ flag: opts.workspace });
    loadEnv({ path: join(ws, ".env") });
    const report = await runDoctor({ workspace: ws });
    for (const c of report.checks) {
      const tag = c.ok ? "PASS" : "FAIL";
      console.log(`[${tag}] ${c.name}: ${c.detail}`);
    }
    process.exit(report.passed ? 0 : 1);
  });

program.command("hook <event>", { hidden: true })
  .action(async (event: string) => {
    const ws = resolveWorkspace({});
    await runHook({ event, workspace: ws, stdin: process.stdin });
  });

program.command("dispatch <agent>", { hidden: true })
  .action(async (agent: string) => {
    const ws = resolveWorkspace({});
    const dispatcher = createDispatcher({ workspace: ws, runner: createRunner() });
    const code = await runDispatch({
      agent, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, dispatcher,
    });
    process.exit(code);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
