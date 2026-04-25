import type { Application, RequestHandler } from "express";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface MountOptions {
  public?: boolean;
}

export interface Mount {
  method: HttpMethod;
  path: string;
  handler: RequestHandler;
  public: boolean;
}

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
  mount?: (method: HttpMethod, path: string, handler: RequestHandler, opts?: MountOptions) => void;
  bus: IngestBus;
  config: Record<string, string>;
  log: (entry: object) => Promise<void>;
}

export interface Channel {
  name: string;
  start(ctx: ChannelContext): Promise<void>;
  stop(): Promise<void>;
  reply(ref: ChannelRef, text: string): Promise<void>;
  signalThinking?(ref: ChannelRef, on: boolean): void;
}
