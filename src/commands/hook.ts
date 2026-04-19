import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { readAll } from "../orchestrator/util/read-stream.js";

interface RunHookArgs {
  event: string;
  workspace: string;
  stdin: Readable;
}

export async function runHook(args: RunHookArgs): Promise<void> {
  const raw = await readAll(args.stdin);
  let payload: Record<string, unknown> = {};
  if (raw.trim().length > 0) {
    try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { payload = { parse_error: raw.slice(0, 200) }; }
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    hook_event_name: args.event,
    ...payload,
  });
  await fs.mkdir(args.workspace, { recursive: true });
  await fs.appendFile(join(args.workspace, "system.log"), line + "\n");
}
