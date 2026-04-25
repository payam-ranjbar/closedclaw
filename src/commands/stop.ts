import { clearPidFile, readPidFile } from "../orchestrator/daemon.js";

interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}
const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

type Signaller = (pid: number, signal: NodeJS.Signals | 0) => void;
const realSignaller: Signaller = (pid, signal) => { process.kill(pid, signal); };

export async function runStop(args: {
  workspace: string;
  force: boolean;
  out: NodeJS.WritableStream;
  err: NodeJS.WritableStream;
  signaller?: Signaller;
  clock?: Clock;
}): Promise<number> {
  const sig = args.signaller ?? realSignaller;
  const clock = args.clock ?? realClock;

  const entry = readPidFile(args.workspace);
  if (!entry) {
    args.out.write("closedclaw not running\n");
    return 0;
  }
  const pid = entry.pid;
  try { sig(pid, 0); }
  catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      clearPidFile(args.workspace);
      args.out.write("closedclaw not running\n");
      return 0;
    }
    throw e;
  }

  try { sig(pid, "SIGTERM"); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ESRCH") {
      clearPidFile(args.workspace);
      args.out.write(`stopped (was pid ${pid})\n`);
      return 0;
    }
    throw e;
  }

  const dead = await pollUntilDead(sig, pid, 5000, clock);
  if (dead) {
    clearPidFile(args.workspace);
    args.out.write(`stopped (was pid ${pid})\n`);
    return 0;
  }

  if (args.force) {
    try { sig(pid, "SIGKILL"); } catch { /* ignore */ }
    const killed = await pollUntilDead(sig, pid, 1000, clock);
    if (killed) {
      clearPidFile(args.workspace);
      args.out.write(`force-stopped (was pid ${pid})\n`);
      return 0;
    }
  }

  args.err.write(`closedclaw (pid ${pid}) did not exit within 5s. Retry with \`closedclaw stop --force\`.\n`);
  return 1;
}

async function pollUntilDead(sig: Signaller, pid: number, withinMs: number, clock: Clock): Promise<boolean> {
  const deadline = clock.now() + withinMs;
  while (clock.now() < deadline) {
    try { sig(pid, 0); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") return true;
      return false;
    }
    await clock.sleep(100);
  }
  return false;
}
