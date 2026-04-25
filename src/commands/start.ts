import { startServer } from "../orchestrator/server.js";
import { clearPidFile, isDaemonAlive } from "../orchestrator/daemon.js";

export interface SpawnedChild {
  pid: number;
  unref(): void;
  once(event: "exit", cb: (code: number | null) => void): this;
}
export type Spawner = (workspace: string, outFd: number, errFd: number) => SpawnedChild;

export async function runStart(args: {
  workspace: string;
  foreground: boolean;
  out: NodeJS.WritableStream;
  err: NodeJS.WritableStream;
  spawner?: Spawner;
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

  args.err.write("background spawn not yet implemented\n");
  return 1;
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
