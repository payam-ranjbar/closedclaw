import {
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export function pidFilePath(workspace: string): string {
  return join(workspace, "state", "closedclaw.pid");
}

export function readPidFile(workspace: string): { pid: number } | null {
  let raw: string;
  try {
    raw = readFileSync(pidFilePath(workspace), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const pid = Number(trimmed);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return { pid };
}

export function writePidFile(workspace: string, pid: number): void {
  const path = pidFilePath(workspace);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(pid) + "\n");
}

export function clearPidFile(workspace: string): void {
  try {
    unlinkSync(pidFilePath(workspace));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

export function startLockPath(workspace: string): string {
  return join(workspace, "state", "closedclaw.start.lock");
}

export function acquireStartLock(workspace: string): void {
  const path = startLockPath(workspace);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(process.pid) + "\n", { flag: "wx" });
}

export function releaseStartLock(workspace: string): void {
  try {
    unlinkSync(startLockPath(workspace));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}
