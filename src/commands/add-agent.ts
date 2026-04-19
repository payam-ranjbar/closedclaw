import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readAgents, writeAgents, type AgentRecord } from "../orchestrator/state.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function runAddAgent(args: { workspace: string; name: string; templatesDir?: string }): Promise<void> {
  const registry = await readAgents(args.workspace);
  if (registry[args.name]) throw new Error(`agent ${args.name} already exists`);

  const templates = args.templatesDir ?? join(PACKAGE_ROOT, "templates");
  const src = join(templates, "agents/backend-dev");
  const dest = join(args.workspace, "agents", args.name);
  await copyDir(src, dest);

  // Git does not track empty directories; create them so the agent has the expected layout.
  await fs.mkdir(join(dest, "memory"), { recursive: true });
  await fs.mkdir(join(dest, "dreams"), { recursive: true });

  const record: AgentRecord = {
    name: args.name,
    cwd: dest,
    sessionId: null,
    createdAt: new Date().toISOString(),
    lastActiveAt: null,
  };
  await writeAgents(args.workspace, { ...registry, [args.name]: record });
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const from = join(src, e.name);
    const to = join(dest, e.name);
    if (e.isDirectory()) await copyDir(from, to);
    else await fs.copyFile(from, to);
  }
}
