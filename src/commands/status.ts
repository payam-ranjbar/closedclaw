import { promises as fs } from "node:fs";
import { join } from "node:path";
import { readAgents } from "../orchestrator/state.js";
import { isDaemonAlive } from "../orchestrator/daemon.js";

export async function runStatus(args: { workspace: string; out: NodeJS.WritableStream }): Promise<void> {
  const live = isDaemonAlive(args.workspace);
  args.out.write(live.running ? `closedclaw running (pid ${live.pid})\n` : "closedclaw not running\n");
  args.out.write("\n");

  const registry = await readAgents(args.workspace);
  args.out.write("Agents:\n");
  for (const [name, rec] of Object.entries(registry)) {
    args.out.write(`  ${name.padEnd(16)} session=${rec.sessionId ?? "<none>"} lastActive=${rec.lastActiveAt ?? "<never>"}\n`);
  }

  const logPath = join(args.workspace, "system.log");
  try {
    const raw = await fs.readFile(logPath, "utf8");
    const tail = raw.split("\n").slice(-10).join("\n");
    args.out.write("\nRecent telemetry (last 10 lines):\n");
    args.out.write(tail + "\n");
  } catch {
    args.out.write("\n(no system.log yet)\n");
  }
}
