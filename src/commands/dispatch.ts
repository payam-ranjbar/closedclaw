import type { Readable, Writable } from "node:stream";
import type { Dispatcher } from "../orchestrator/dispatch/core.js";
import { readAll } from "../orchestrator/util/read-stream.js";

interface RunDispatchArgs {
  agent: string;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  dispatcher: Dispatcher;
  correlationId?: string;
}

export async function runDispatch(args: RunDispatchArgs): Promise<number> {
  const payload = await readAll(args.stdin);
  const result = await args.dispatcher.dispatch({
    agent: args.agent,
    payload,
    correlationId: args.correlationId,
    origin: { kind: "host-delegation", name: "host" },
  });

  if (result.ok) {
    args.stdout.write(result.result ?? "");
    return 0;
  }
  args.stderr.write(`${result.error?.code}: ${result.error?.message}\n`);
  return 1;
}
