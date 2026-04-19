import type { Application } from "express";

export interface ChannelRef {
  channel: string;
  conversationId: string;
  userId?: string;
  raw?: unknown;
}

export interface IngestBus {
  submit(ref: ChannelRef, text: string): Promise<void>;
}

export interface ChannelContext {
  app: Application;
  bus: IngestBus;
  config: Record<string, string>;
}

export interface Channel {
  name: string;
  start(ctx: ChannelContext): Promise<void>;
  stop(): Promise<void>;
  reply(ref: ChannelRef, text: string): Promise<void>;
}
