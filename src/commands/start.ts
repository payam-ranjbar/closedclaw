import { startServer } from "../orchestrator/server.js";

export async function runStart(args: { workspace: string }): Promise<void> {
  await startServer(args.workspace);
}
