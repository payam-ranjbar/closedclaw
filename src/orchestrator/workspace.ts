import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface ResolveOptions {
  flag?: string;
  cwd?: string;
}

export function resolveWorkspace(opts: ResolveOptions = {}): string {
  if (opts.flag) return resolve(opts.flag);

  const envVar = process.env.CLOSEDCLAW_WORKSPACE;
  if (envVar) return resolve(envVar);

  const cwdWorkspace = join(opts.cwd ?? process.cwd(), "workspace");
  if (existsSync(cwdWorkspace) && statSync(cwdWorkspace).isDirectory()) {
    return resolve(cwdWorkspace);
  }

  return join(homedir(), ".closedclaw");
}
