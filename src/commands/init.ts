import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface RunInitArgs {
  workspace: string;
  force: boolean;
  templatesDir?: string;
}

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function runInit(args: RunInitArgs): Promise<void> {
  const templates = args.templatesDir ?? join(PACKAGE_ROOT, "templates");

  const exists = await dirExists(args.workspace);
  if (exists && !args.force) {
    throw new Error(`workspace already exists at ${args.workspace} (use --force to overwrite)`);
  }

  await fs.mkdir(join(args.workspace, "state"), { recursive: true });
  await fs.mkdir(join(args.workspace, "agents"), { recursive: true });

  await copyDir(join(templates, "workspace"), args.workspace);
  await copyDir(join(templates, "agents"), join(args.workspace, "agents"));
  await ensureAgentDirs(join(args.workspace, "agents"));

  const agentsPath = join(args.workspace, "agents.json");
  const raw = await fs.readFile(agentsPath, "utf8");
  const now = new Date().toISOString();
  // Double backslashes so Windows paths survive JSON parsing without mutating the raw workspace string.
  const wsForJson = args.workspace.replaceAll("\\", "\\\\");
  const substituted = raw
    .replaceAll("{{WORKSPACE}}", wsForJson)
    .replaceAll("{{NOW}}", now);
  await fs.writeFile(agentsPath, substituted);

  const secrets = { telegramWebhookSecret: randomBytes(24).toString("hex") };
  await fs.writeFile(join(args.workspace, "state/secrets.json"), JSON.stringify(secrets, null, 2));
}

async function dirExists(p: string): Promise<boolean> {
  try { const s = await fs.stat(p); return s.isDirectory(); } catch { return false; }
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

// Git does not track empty directories; recreate them so every agent has the expected layout.
async function ensureAgentDirs(agentsDest: string): Promise<void> {
  const agents = await fs.readdir(agentsDest, { withFileTypes: true });
  for (const a of agents) {
    if (!a.isDirectory()) continue;
    await fs.mkdir(join(agentsDest, a.name, "memory"), { recursive: true });
    await fs.mkdir(join(agentsDest, a.name, "dreams"), { recursive: true });
  }
}
