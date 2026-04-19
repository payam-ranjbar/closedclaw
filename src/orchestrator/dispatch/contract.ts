export interface DispatchRequest {
  agent: string;
  payload: string;
  correlationId?: string;
  timeoutMs?: number;
  origin?: {
    kind: "channel" | "trigger" | "host-delegation";
    name: string;
  };
}

export type DispatchErrorCode =
  | "UNKNOWN_AGENT"
  | "WORKER_BUSY"
  | "WORKER_CRASH"
  | "TIMEOUT"
  | "INTERNAL";

export interface DispatchError {
  code: DispatchErrorCode;
  message: string;
}

export interface DispatchResult {
  ok: boolean;
  agent: string;
  sessionId: string;
  result?: string;
  error?: DispatchError;
  durationMs: number;
  queuedMs: number;
  tokenUsage?: { input: number; output: number };
}

export interface RunnerOutcome {
  sessionId: string;
  result: string;
  tokenUsage?: { input: number; output: number };
}

export interface Runner {
  run(args: { agent: string; payload: string; workspace: string }): Promise<RunnerOutcome>;
}
