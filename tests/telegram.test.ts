import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { TelegramChannel, classifyError } from "../src/orchestrator/channels/telegram.js";
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

const mountFor = (a: express.Express) => (
  method: string,
  path: string,
  handler: any,
  _opts?: { public?: boolean },
): void => {
  const verb = method.toLowerCase() as "get" | "post" | "put" | "delete" | "patch";
  (a as any)[verb](path, handler);
};

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
      modeOverride: "webhook",
    });
    await channel.start({
      app,
      mount: mountFor(app),
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

  it("logs telegram.reply.sent with status on a 2xx sendMessage response", async () => {
    const localLog: object[] = [];
    const ch = new TelegramChannel({
      fetcher: async () => new Response("{}", { status: 200 }),
      secretOverride: secret,
      modeOverride: "webhook",
    });
    const { app: app2, server: server2 } = await startApp();
    try {
      await ch.start({
        app: app2,
        mount: mountFor(app2),
        bus: { submit: async () => {} },
        config: { token: "bot-token" },
        log: async (entry) => { localLog.push(entry); },
      });
      await ch.reply({ channel: "telegram", conversationId: "99" }, "hi back");
      expect(localLog).toContainEqual(expect.objectContaining({
        channel: "telegram",
        event: "telegram.reply.sent",
        chatId: "99",
        status: 200,
      }));
    } finally {
      server2.close();
    }
  });

  it("logs telegram.reply.failed when sendMessage returns a non-2xx status", async () => {
    const localLog: object[] = [];
    const ch = new TelegramChannel({
      fetcher: async () => new Response("{}", { status: 500 }),
      secretOverride: secret,
      modeOverride: "webhook",
    });
    const { app: app2, server: server2 } = await startApp();
    try {
      await ch.start({
        app: app2,
        mount: mountFor(app2),
        bus: { submit: async () => {} },
        config: { token: "bot-token" },
        log: async (entry) => { localLog.push(entry); },
      });
      await ch.reply({ channel: "telegram", conversationId: "99" }, "x");
      expect(localLog).toContainEqual(expect.objectContaining({
        channel: "telegram",
        event: "telegram.reply.failed",
        chatId: "99",
        error: "HTTP 500",
      }));
    } finally {
      server2.close();
    }
  });

  it("logs telegram.ingest.failed when bus.submit rejects", async () => {
    const { app: app2, server: server2, port: port2 } = await startApp();
    const localLog: object[] = [];
    const localBus = { submit: async () => { throw new Error("bus down"); } };
    const ch = new TelegramChannel({
      fetcher: async () => new Response("{}"),
      secretOverride: secret,
      modeOverride: "webhook",
    });
    await ch.start({
      app: app2,
      mount: mountFor(app2),
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

  it("signalThinking(true) sends sendChatAction immediately and again on the 4s tick", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const ch = new TelegramChannel({
      fetcher: async (input) => { calls.push(String(input)); return new Response("{}"); },
      secretOverride: secret,
      modeOverride: "webhook",
    });
    const { app: app2, server: server2 } = await startApp();
    try {
      await ch.start({
        app: app2,
        mount: mountFor(app2),
        bus: { submit: async () => {} },
        config: { token: "bot-token" },
        log: async () => {},
      });
      ch.signalThinking!({ channel: "telegram", conversationId: "99" }, true);
      await Promise.resolve();
      const typingCalls = () => calls.filter((u) => u.includes("sendChatAction")).length;
      expect(typingCalls()).toBe(1);
      await vi.advanceTimersByTimeAsync(4000);
      expect(typingCalls()).toBe(2);
      await vi.advanceTimersByTimeAsync(4000);
      expect(typingCalls()).toBe(3);
      ch.signalThinking!({ channel: "telegram", conversationId: "99" }, false);
      await ch.stop();
    } finally {
      server2.close();
      vi.useRealTimers();
    }
  });

  it("signalThinking(false) clears the interval and stops further sendChatAction calls", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const ch = new TelegramChannel({
      fetcher: async (input) => { calls.push(String(input)); return new Response("{}"); },
      secretOverride: secret,
      modeOverride: "webhook",
    });
    const { app: app2, server: server2 } = await startApp();
    try {
      await ch.start({
        app: app2,
        mount: mountFor(app2),
        bus: { submit: async () => {} },
        config: { token: "bot-token" },
        log: async () => {},
      });
      const ref = { channel: "telegram", conversationId: "99" };
      ch.signalThinking!(ref, true);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(4000);
      const before = calls.filter((u) => u.includes("sendChatAction")).length;
      expect(before).toBe(2);
      ch.signalThinking!(ref, false);
      await vi.advanceTimersByTimeAsync(20000);
      const after = calls.filter((u) => u.includes("sendChatAction")).length;
      expect(after).toBe(2);
    } finally {
      server2.close();
      vi.useRealTimers();
    }
  });

  it("signalThinking(true) twice on the same conversation replaces the existing timer (no stacking)", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const ch = new TelegramChannel({
      fetcher: async (input) => { calls.push(String(input)); return new Response("{}"); },
      secretOverride: secret,
      modeOverride: "webhook",
    });
    const { app: app2, server: server2 } = await startApp();
    try {
      await ch.start({
        app: app2,
        mount: mountFor(app2),
        bus: { submit: async () => {} },
        config: { token: "bot-token" },
        log: async () => {},
      });
      const ref = { channel: "telegram", conversationId: "99" };
      ch.signalThinking!(ref, true);
      await Promise.resolve();
      ch.signalThinking!(ref, true);
      await Promise.resolve();
      const beforeTicks = calls.filter((u) => u.includes("sendChatAction")).length;
      expect(beforeTicks).toBe(2);
      await vi.advanceTimersByTimeAsync(4000);
      const afterOneTick = calls.filter((u) => u.includes("sendChatAction")).length;
      expect(afterOneTick).toBe(3);
      await ch.stop();
    } finally {
      server2.close();
      vi.useRealTimers();
    }
  });

  describe("TelegramChannel.pollLoop happy path", () => {
    it("calls getUpdates with offset=0 and timeout=25 on first iteration, dispatches updates, bumps offset", async () => {
      const calls: string[] = [];
      let updateReturned = false;
      const ch = new TelegramChannel({
        fetcher: async (input) => {
          const url = String(input);
          calls.push(url);
          if (url.includes("/deleteWebhook")) return new Response("{}", { status: 200 });
          if (url.includes("/getUpdates")) {
            if (updateReturned) {
              return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
            }
            updateReturned = true;
            return new Response(
              JSON.stringify({
                ok: true,
                result: [{
                  update_id: 100,
                  message: { message_id: 1, chat: { id: 42 }, from: { id: 7 }, text: "hi" },
                }],
              }),
              { status: 200 },
            );
          }
          return new Response("{}", { status: 200 });
        },
        secretOverride: "s",
        modeOverride: "polling",
        sleep: async () => {},
      });
      const submitted: { ref: ChannelRef; text: string }[] = [];
      const { app: a, server: s } = await startApp();
      try {
        await ch.start({
          app: a,
          mount: mountFor(a),
          bus: { submit: async (ref, text) => { submitted.push({ ref, text }); } },
          config: { token: "bot-token" },
          log: async () => {},
        });
        // Yield to let the poll loop run a few iterations.
        await new Promise((r) => setTimeout(r, 30));
        await ch.stop();
        const getUpdatesCalls = calls.filter((u) => u.includes("/getUpdates"));
        expect(getUpdatesCalls.length).toBeGreaterThanOrEqual(1);
        expect(getUpdatesCalls[0]).toMatch(/offset=0/);
        expect(getUpdatesCalls[0]).toMatch(/timeout=25/);
        expect(submitted).toHaveLength(1);
        expect(submitted[0].text).toBe("hi");
        expect(submitted[0].ref.conversationId).toBe("42");
        expect(submitted[0].ref.userId).toBe("7");
        if (getUpdatesCalls.length >= 2) {
          expect(getUpdatesCalls[1]).toMatch(/offset=101/);
        }
      } finally {
        s.close();
      }
    });
  });

  describe("TelegramChannel.deleteWebhook (private, exercised via polling startup)", () => {
    it("calls /deleteWebhook once on success", async () => {
      const calls: string[] = [];
      const ch = new TelegramChannel({
        fetcher: async (input) => { calls.push(String(input)); return new Response("{}", { status: 200 }); },
        secretOverride: "s",
        modeOverride: "polling",
        sleep: async () => {},
      });
      const { app: a, server: s } = await startApp();
      try {
        await ch.start({
          app: a,
          mount: mountFor(a),
          bus: { submit: async () => {} },
          config: { token: "bot-token" },
          log: async () => {},
        });
        await ch.stop();
        expect(calls.filter((u) => u.includes("/deleteWebhook"))).toHaveLength(1);
      } finally {
        s.close();
      }
    });

    it("retries deleteWebhook up to 3 times on failure, then logs fatal", async () => {
      const log: any[] = [];
      let calls = 0;
      const ch = new TelegramChannel({
        fetcher: async () => { calls++; return new Response("{}", { status: 500 }); },
        secretOverride: "s",
        modeOverride: "polling",
        sleep: async () => {},
      });
      const { app: a, server: s } = await startApp();
      try {
        await ch.start({
          app: a,
          mount: mountFor(a),
          bus: { submit: async () => {} },
          config: { token: "bot-token" },
          log: async (e) => { log.push(e); },
        });
        await ch.stop();
        expect(calls).toBe(3);
        expect(log).toContainEqual(expect.objectContaining({
          event: "telegram.polling.fatal",
          reason: "webhook-cleanup",
        }));
      } finally {
        s.close();
      }
    });
  });
});

describe("classifyError", () => {
  it("classifies 401 as fatal-auth", () => {
    expect(classifyError({ kind: "http", status: 401, body: {} })).toEqual({ kind: "fatal-auth" });
  });

  it("classifies 429 with retry_after as rate-limit", () => {
    expect(classifyError({ kind: "http", status: 429, body: { parameters: { retry_after: 4 } } }))
      .toEqual({ kind: "rate-limit", delayMs: 4000 });
  });

  it("classifies 429 without retry_after with a 1s default", () => {
    expect(classifyError({ kind: "http", status: 429, body: {} }))
      .toEqual({ kind: "rate-limit", delayMs: 1000 });
  });

  it("classifies 409 as conflict", () => {
    expect(classifyError({ kind: "http", status: 409, body: {} }).kind).toBe("conflict");
  });

  it("classifies 5xx as transient", () => {
    expect(classifyError({ kind: "http", status: 502, body: {} }).kind).toBe("transient");
  });

  it("classifies network errors as transient", () => {
    expect(classifyError({ kind: "network", error: new Error("ECONNRESET") }).kind).toBe("transient");
  });
});
