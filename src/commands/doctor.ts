import { promises as fs } from "node:fs";
import { join } from "node:path";
import crossSpawn from "cross-spawn";
import { fetch } from "undici";

export interface DoctorReport {
  passed: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

export async function runDoctor(args: { workspace: string }): Promise<DoctorReport> {
  const checks: DoctorReport["checks"] = [];

  checks.push(await checkWorkspaceExists(args.workspace));
  checks.push(await checkAgentsJson(args.workspace));
  checks.push(await checkEnv(args.workspace));
  checks.push(await checkBinary("claude"));
  checks.push(await checkBinary("closedclaw"));
  checks.push(await checkTunnel(args.workspace));

  return { passed: checks.every((c) => c.ok), checks };
}

async function checkWorkspaceExists(ws: string): Promise<DoctorReport["checks"][number]> {
  try {
    await fs.stat(ws);
    return { name: "workspace exists", ok: true, detail: ws };
  } catch {
    return { name: "workspace exists", ok: false, detail: `missing: ${ws}` };
  }
}

async function checkAgentsJson(ws: string): Promise<DoctorReport["checks"][number]> {
  try {
    const raw = await fs.readFile(join(ws, "agents.json"), "utf8");
    const parsed = JSON.parse(raw);
    const count = Object.keys(parsed).length;
    return { name: "agents.json readable", ok: count > 0, detail: `${count} agents` };
  } catch (err: unknown) {
    return { name: "agents.json readable", ok: false, detail: String(err) };
  }
}

async function checkEnv(ws: string): Promise<DoctorReport["checks"][number]> {
  try {
    await fs.access(join(ws, ".env"));
    const tokenSet = !!process.env.TELEGRAM_BOT_TOKEN;
    return { name: ".env present, token set", ok: tokenSet, detail: tokenSet ? "ok" : "TELEGRAM_BOT_TOKEN missing" };
  } catch {
    return { name: ".env present, token set", ok: false, detail: ".env missing" };
  }
}

async function checkBinary(bin: string): Promise<DoctorReport["checks"][number]> {
  return new Promise((resolve) => {
    const child = crossSpawn(bin, ["--version"], { stdio: "ignore", windowsHide: true });
    child.on("error", () => resolve({ name: `${bin} on PATH`, ok: false, detail: "not found" }));
    child.on("exit", (code) => resolve({ name: `${bin} on PATH`, ok: code === 0, detail: code === 0 ? "ok" : `exited ${code}` }));
  });
}

async function checkTunnel(_ws: string): Promise<DoctorReport["checks"][number]> {
  const url = process.env.PUBLIC_BASE_URL;
  if (!url) return { name: "PUBLIC_BASE_URL reachable", ok: false, detail: "PUBLIC_BASE_URL unset" };
  try {
    const res = await fetch(url, { method: "HEAD" });
    return { name: "PUBLIC_BASE_URL reachable", ok: res.status < 500, detail: `HTTP ${res.status}` };
  } catch (err: unknown) {
    return { name: "PUBLIC_BASE_URL reachable", ok: false, detail: String(err) };
  }
}
