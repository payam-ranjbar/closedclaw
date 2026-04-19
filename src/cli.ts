#!/usr/bin/env node
import { Command } from "commander";
import { config as loadEnv } from "dotenv";
import { join } from "node:path";
import { resolveWorkspace } from "./orchestrator/workspace.js";
import { runInit } from "./commands/init.js";
import { runStart } from "./commands/start.js";
import { runAddAgent } from "./commands/add-agent.js";
import { runStatus } from "./commands/status.js";
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
