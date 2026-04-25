import crossSpawn from "cross-spawn";
import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { readAgents } from "../state.js";
import type { Runner, RunnerOutcome } from "./contract.js";

export type SpawnFn = (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; windowsHide?: boolean }) => ChildProcess;

interface Options {
  spawn?: SpawnFn;
}

export function createRunner(opts: Options = {}): Runner {
  const spawn = opts.spawn ?? (crossSpawn as SpawnFn);

  return {
    async run({ agent, payload, workspace }): Promise<RunnerOutcome> {
      const registry = await readAgents(workspace);
      const record = registry[agent];
      if (!record) throw new Error(`unknown agent: ${agent}`);

      const args = [
        "-p", payload,
        "--output-format", "stream-json", "--verbose",
        "--permission-mode", "bypassPermissions",
      ];
      if (record.sessionId) args.push("--resume", record.sessionId);
      if (record.model) args.push("--model", record.model);

      const child = spawn("claude", args, {
        cwd: record.cwd,
        env: { ...process.env, CLOSEDCLAW_WORKSPACE: workspace },
        windowsHide: true,
      });

      let sessionId = record.sessionId ?? "";
      let result: string | undefined;
      let usage: RunnerOutcome["tokenUsage"];
      const stderrChunks: string[] = [];

      const rl = createInterface({ input: child.stdout! });
      rl.on("line", (line) => {
        if (!line.trim()) return;
        const msg = parseLine(line);
        if (!msg) return;
        if (msg.type === "system" && msg.subtype === "init" && typeof msg.session_id === "string") {
          sessionId = msg.session_id;
        } else if (msg.type === "result" && typeof msg.result === "string") {
          result = msg.result;
          if (msg.usage?.input_tokens != null && msg.usage?.output_tokens != null) {
            usage = { input: msg.usage.input_tokens, output: msg.usage.output_tokens };
          }
        }
      });

      child.stderr!.on("data", (b: Buffer) => stderrChunks.push(b.toString()));

      const exitCode: number = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", (code) => resolve(code ?? 1));
      });

      if (exitCode !== 0) {
        throw new Error(`claude exited ${exitCode}: ${stderrChunks.join("").slice(-500)}`);
      }
      if (result === undefined) throw new Error("no result produced");
      if (!sessionId) throw new Error("no session_id captured");

      return { sessionId, result, tokenUsage: usage };
    },
  };
}

interface StreamMessage {
  type?: string;
  subtype?: string;
  session_id?: string;
  result?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function parseLine(line: string): StreamMessage | null {
  try { return JSON.parse(line) as StreamMessage; } catch { return null; }
}
