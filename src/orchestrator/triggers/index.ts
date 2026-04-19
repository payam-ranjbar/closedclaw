import type { Channel, ChannelRef, IngestBus } from "../channels/index.js";
import type { AgentRegistry } from "../state.js";

export interface CronSpec {
  id: string;
  schedule: string;
  agent: string;
  payload: string;
  reply_to: { channel: string; conversationId: string } | null;
  timeoutMs?: number;
}

export interface TriggerContext {
  bus: IngestBus;
  channels: Map<string, Channel>;
  registry: AgentRegistry;
  workspace: string;
}
// registry is exposed for triggers that need to iterate or validate known agents
// (e.g., future inbox-polling trigger that fans out to every agent).

export interface Trigger {
  name: string;
  start(ctx: TriggerContext): Promise<void>;
  stop(): Promise<void>;
}

export type { ChannelRef };
