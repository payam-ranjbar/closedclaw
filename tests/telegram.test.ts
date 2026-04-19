import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { TelegramChannel } from "../src/orchestrator/channels/telegram.js";
import type { ChannelRef } from "../src/orchestrator/channels/index.js";

function startApp(): Promise<{ app: express.Express; server: Server; port: number }> {
  const app = express();
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ app, server, port });
    });
  });
}

describe("TelegramChannel", () => {
  let submitted: { ref: ChannelRef; text: string }[];
  let logEntries: object[];
  let app: express.Express;
  let server: Server;
  let port: number;
  const secret = "test-secret";

  beforeEach(async () => {
    ({ app, server, port } = await startApp());
    submitted = [];
    logEntries = [];
    const bus = { submit: async (ref: ChannelRef, text: string) => { submitted.push({ ref, text }); } };
    const channel = new TelegramChannel({
      fetcher: async () => new Response("{}"),
      secretOverride: secret,
    });
    await channel.start({
      app,
      bus,
      config: { token: "bot-token", publicBaseUrl: "https://x.example" },
      log: async (entry) => { logEntries.push(entry); },
    });
  });

  afterEach(() => { server?.close(); });

  it("accepts a valid Telegram update and submits to the bus", async () => {
    const res = await fetch(`http://localhost:${port}/webhooks/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify({
        update_id: 1,
        message: { message_id: 10, from: { id: 7, is_bot: false, first_name: "u" },
                   chat: { id: 99, type: "private" }, text: "hi" },
      }),
    });
    expect(res.status).toBe(200);
    expect(submitted).toHaveLength(1);
    expect(submitted[0].text).toBe("hi");
    expect(submitted[0].ref.conversationId).toBe("99");
  });

  it("rejects a request with a missing or wrong secret token", async () => {
    const res = await fetch(`http://localhost:${port}/webhooks/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: 2 }),
    });
    expect(res.status).toBe(401);
    expect(submitted).toHaveLength(0);
  });

  it("logs telegram.message.received with chatId, userId, messageId, textLength", async () => {
    const res = await fetch(`http://localhost:${port}/webhooks/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify({
        update_id: 1,
        message: { message_id: 10, from: { id: 7, is_bot: false, first_name: "u" },
                   chat: { id: 99, type: "private" }, text: "hello" },
      }),
    });
    expect(res.status).toBe(200);
    const received = logEntries.find((e: any) => e.event === "telegram.message.received") as any;
    expect(received).toBeDefined();
    expect(received.channel).toBe("telegram");
    expect(received.chatId).toBe("99");
    expect(received.userId).toBe("7");
    expect(received.messageId).toBe(10);
    expect(received.textLength).toBe(5);
  });

  it("logs telegram.webhook.rejected on bad secret", async () => {
    const res = await fetch(`http://localhost:${port}/webhooks/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: 2 }),
    });
    expect(res.status).toBe(401);
    expect(logEntries).toContainEqual(expect.objectContaining({
      channel: "telegram",
      event: "telegram.webhook.rejected",
      reason: "bad-secret",
    }));
  });

  it("logs telegram.message.ignored when message has no text", async () => {
    const res = await fetch(`http://localhost:${port}/webhooks/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify({
        update_id: 3,
        message: { message_id: 11, chat: { id: 99, type: "private" } },
      }),
    });
    expect(res.status).toBe(200);
    expect(logEntries).toContainEqual(expect.objectContaining({
      channel: "telegram",
      event: "telegram.message.ignored",
      reason: "no-text",
    }));
  });

  it("logs telegram.ingest.failed when bus.submit rejects", async () => {
    const { app: app2, server: server2, port: port2 } = await startApp();
    const localLog: object[] = [];
    const localBus = { submit: async () => { throw new Error("bus down"); } };
    const ch = new TelegramChannel({
      fetcher: async () => new Response("{}"),
      secretOverride: secret,
    });
    await ch.start({
      app: app2,
      bus: localBus,
      config: { token: "bot-token" },
      log: async (entry) => { localLog.push(entry); },
    });
    try {
      const res = await fetch(`http://localhost:${port2}/webhooks/telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
        body: JSON.stringify({
          update_id: 4,
          message: { message_id: 12, from: { id: 7 }, chat: { id: 99, type: "private" }, text: "hi" },
        }),
      });
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      expect(localLog).toContainEqual(expect.objectContaining({
        channel: "telegram",
        event: "telegram.ingest.failed",
        chatId: "99",
        error: expect.stringContaining("bus down"),
      }));
    } finally {
      server2.close();
    }
  });
});
