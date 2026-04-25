import { mkdirSync, openSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import crossSpawn from "cross-spawn";
import type { ChildProcess } from "node:child_process";
import { startServer } from "../orchestrator/server.js";
import {
  acquireStartLock,
  clearPidFile,
  isDaemonAlive,
  releaseStartLock,
  startLockPath,
  writePidFile,
} from "../orchestrator/daemon.js";

export interface SpawnedChild {
  pid: number;
  unref(): void;
  once(event: "exit", cb: (code: number | null) => void): this;
  kill(signal?: NodeJS.Signals | number): boolean;
}
export type Spawner = (workspace: string, outFd: number, errFd: number) => SpawnedChild;

const realSpawner: Spawner = (workspace, outFd, errFd) => {
  const child: ChildProcess = crossSpawn(
    process.execPath,
    [process.argv[1], "__daemon", "--workspace", workspace],
    { detached: true, stdio: ["ignore", outFd, errFd] },
  );
  if (child.pid === undefined) throw new Error("failed to spawn daemon: no pid");
  const wrapper: SpawnedChild = {
    pid: child.pid,
    unref: () => child.unref(),
    once: (event, cb) => { child.once(event, cb); return wrapper; },
    kill: (signal) => child.kill(signal),
  };
  return wrapper;
};

export async function runStart(args: {
  workspace: string;
  foreground: boolean;
  out: NodeJS.WritableStream;
  err: NodeJS.WritableStream;
  spawner?: Spawner;
  stabilizeMs?: number;
}): Promise<number> {
  const live = isDaemonAlive(args.workspace);

  if (args.foreground) {
    if (live.running) {
      args.err.write(`closedclaw already running in background (pid ${live.pid}). Stop it first.\n`);
      return 1;
    }
    await runDaemon({ workspace: args.workspace });
    return 0;
  }

  if (live.running) {
    args.out.write(`closedclaw already running (pid ${live.pid})\n`);
    return 0;
  }

  mkdirSync(join(args.workspace, "state"), { recursive: true });
  mkdirSync(join(args.workspace, "logs"), { recursive: true });

  try { acquireStartLock(args.workspace); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const recheck = isDaemonAlive(args.workspace);
    if (recheck.running) {
      args.out.write(`closedclaw already running (pid ${recheck.pid})\n`);
      return 0;
    }
    const lockHolder = readLockHolder(args.workspace);
    if (lockHolder !== null && isPidAliveInline(lockHolder)) {
      args.err.write(`another start is in progress (launcher pid ${lockHolder}). Wait or remove ${startLockPath(args.workspace)} if it is genuinely stale.\n`);
      return 1;
    }
    releaseStartLock(args.workspace);
    try { acquireStartLock(args.workspace); }
    catch (e2) {
      if ((e2 as NodeJS.ErrnoException).code === "EEXIST") {
        args.err.write("state/closedclaw.start.lock exists and is not recoverable. Inspect and remove.\n");
        return 1;
      }
      throw e2;
    }
  }

  let spawned: SpawnedChild | undefined;
  try {
    const outFd = openSync(join(args.workspace, "logs", "daemon.out"), "a");
    const errFd = openSync(join(args.workspace, "logs", "daemon.err"), "a");

    const spawner = args.spawner ?? realSpawner;
    spawned = spawner(args.workspace, outFd, errFd);
    spawned.unref();
    // PID file before lock release: an observer either sees closedclaw.pid (daemon up) or sees the lock (launcher in flight) — never the gap.
    writePidFile(args.workspace, spawned.pid);
  } catch (e) {
    if (spawned) { try { spawned.kill("SIGTERM"); } catch { /* already dead */ } }
    releaseStartLock(args.workspace);
    throw e;
  }
  releaseStartLock(args.workspace);

  const child = spawned;
  const stabilizeMs = args.stabilizeMs ?? 2000;
  const exited = await raceExit(child, stabilizeMs);
  if (exited.crashed) {
    clearPidFile(args.workspace);
    const tail = tailFile(join(args.workspace, "logs", "daemon.err"), 20);
    args.err.write(tail);
    args.err.write(`closedclaw failed to start (exit code ${exited.code}). See ${join(args.workspace, "logs", "daemon.err")}\n`);
    return 1;
  }

  args.out.write(`closedclaw running (pid ${child.pid})\nworkspace: ${args.workspace}\nlogs: ${join(args.workspace, "logs")}\n`);
  return 0;
}

function raceExit(child: SpawnedChild, ms: number): Promise<{ crashed: boolean; code: number | null }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ crashed: false, code: null }), ms);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ crashed: true, code });
    });
  });
}

function readLockHolder(workspace: string): number | null {
  let raw: string;
  try { raw = readFileSync(startLockPath(workspace), "utf8"); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const pid = Number(trimmed);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isPidAliveInline(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw e;
  }
}

function tailFile(path: string, lines: number): string {
  let raw: string;
  try {
    const size = statSync(path).size;
    if (size === 0) return "";
    raw = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
  const all = raw.split("\n");
  const drop = Math.max(0, all.length - lines - 1);
  const slice = all.slice(drop).join("\n");
  return slice.endsWith("\n") ? slice : slice + "\n";
}

export async function runDaemon(args: { workspace: string }): Promise<void> {
  const handle = await startServer(args.workspace);
  const onSig = (): void => {
    void (async () => {
      try { await handle.stop(); } finally {
        clearPidFile(args.workspace);
        process.exit(0);
      }
    })();
  };
  process.once("SIGTERM", onSig);
  process.once("SIGINT", onSig);
}
