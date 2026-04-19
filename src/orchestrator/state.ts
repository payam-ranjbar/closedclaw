import { promises as fs } from "node:fs";
import { join } from "node:path";

export interface AgentRecord {
  name: string;
  cwd: string;
  sessionId: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  model?: string;
}

export type AgentRegistry = Record<string, AgentRecord>;

const FILE = "agents.json";
const BAK = "agents.json.bak";

export async function readAgents(workspace: string): Promise<AgentRegistry> {
  const primary = join(workspace, FILE);
  try {
    const raw = await fs.readFile(primary, "utf8");
    return JSON.parse(raw);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    const bak = join(workspace, BAK);
    const raw = await fs.readFile(bak, "utf8");
    return JSON.parse(raw);
  }
}

export async function writeAgents(workspace: string, registry: AgentRegistry): Promise<void> {
  const primary = join(workspace, FILE);
  const bak = join(workspace, BAK);
  const tmp = `${primary}.tmp-${process.pid}-${Date.now()}`;

  try {
    const existing = await fs.readFile(primary, "utf8");
    await fs.writeFile(bak, existing);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  await fs.writeFile(tmp, JSON.stringify(registry, null, 2));
  await fs.rename(tmp, primary);
}

export async function updateAgent(
  workspace: string,
  name: string,
  patch: Partial<AgentRecord>,
): Promise<void> {
  const registry = await readAgents(workspace);
  const current = registry[name];
  if (!current) throw new Error(`unknown agent: ${name}`);
  registry[name] = { ...current, ...patch };
  await writeAgents(workspace, registry);
}
