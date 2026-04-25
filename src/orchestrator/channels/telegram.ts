import express from "express";
import { fetch } from "undici";
import type { Channel, ChannelContext, ChannelRef } from "./index.js";

type Fetcher = typeof fetch;
type Sleeper = (ms: number, signal: AbortSignal) => Promise<void>;

const defaultSleep: Sleeper = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const handle = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(handle);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

interface Options {
  fetcher?: Fetcher;
  secretOverride?: string;
  sleep?: Sleeper;
  modeOverride?: "polling" | "webhook";
}

interface TelegramUpdate {
  update_id: number;
  message?: { message_id: number; chat: { id: number }; from?: { id: number }; text?: string };
}

type TelegramLogEvent =
  | { event: "telegram.message.received";  chatId: string; userId?: string; messageId: number; textLength: number }
  | { event: "telegram.message.ignored";   reason: "no-text" | "no-chat-id" }
  | { event: "telegram.webhook.rejected";  reason: "bad-secret" }
  | { event: "telegram.reply.sent";        chatId: string; status: number }
  | { event: "telegram.reply.failed";      chatId: string; error: string }
  | { event: "telegram.ingest.failed";     chatId: string; error: string };

export class TelegramChannel implements Channel {
  readonly name = "telegram";
  private secret = "";
  private token = "";
  private fetcher: Fetcher;
  private sleep: Sleeper;
  private modeOverride: "polling" | "webhook" | null;
  private logEntry: ChannelContext["log"] = async () => {};
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly opts: Options = {}) {
    this.fetcher = opts.fetcher ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.modeOverride = opts.modeOverride ?? null;
    void (this.sleep, this.modeOverride); // satisfy noUnusedLocals; T5 reads both
  }

  async start(ctx: ChannelContext): Promise<void> {
    this.token = ctx.config.token ?? process.env.TELEGRAM_BOT_TOKEN ?? "";
    this.secret = this.opts.secretOverride
      ?? ctx.config.secret
      ?? process.env.TELEGRAM_WEBHOOK_SECRET
      ?? "";
    this.logEntry = ctx.log;

    ctx.mount("POST", "/webhooks/telegram", express.json());
    ctx.mount("POST", "/webhooks/telegram", async (req, res) => {
      if (req.header("x-telegram-bot-api-secret-token") !== this.secret) {
        await this.log({ event: "telegram.webhook.rejected", reason: "bad-secret" });
        res.status(401).json({ ok: false });
        return;
      }
      const body = req.body as TelegramUpdate;
      if (!body?.message?.text) {
        await this.log({ event: "telegram.message.ignored", reason: "no-text" });
        res.json({ ok: true });
        return;
      }
      if (!body.message.chat?.id) {
        await this.log({ event: "telegram.message.ignored", reason: "no-chat-id" });
        res.json({ ok: true });
        return;
      }
      const chatId = String(body.message.chat.id);
      const ref: ChannelRef = {
        channel: "telegram",
        conversationId: chatId,
        userId: body.message.from ? String(body.message.from.id) : undefined,
        raw: body,
      };
      await this.log({
        event: "telegram.message.received",
        chatId,
        userId: ref.userId,
        messageId: body.message.message_id,
        textLength: body.message.text.length,
      });
      res.json({ ok: true });
      ctx.bus.submit(ref, body.message.text).catch(async (err) => {
        await this.log({ event: "telegram.ingest.failed", chatId, error: String(err) });
      });
    }, { public: true });

    if (ctx.config.publicBaseUrl && this.token) {
      await this.registerWebhook(ctx.config.publicBaseUrl);
    }
  }

  async stop(): Promise<void> {
    for (const handle of this.timers.values()) clearInterval(handle);
    this.timers.clear();
  }

  async reply(ref: ChannelRef, text: string): Promise<void> {
    if (!this.token) return;
    const chatId = ref.conversationId;
    try {
      const res = await this.fetcher(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: Number(chatId), text }),
      });
      if (res.status >= 200 && res.status < 300) {
        await this.log({ event: "telegram.reply.sent", chatId, status: res.status });
      } else {
        await this.log({ event: "telegram.reply.failed", chatId, error: `HTTP ${res.status}` });
      }
    } catch (err) {
      await this.log({ event: "telegram.reply.failed", chatId, error: String(err) });
    }
  }

  signalThinking(ref: ChannelRef, on: boolean): void {
    const key = ref.conversationId;
    const existing = this.timers.get(key);
    if (existing) {
      clearInterval(existing);
      this.timers.delete(key);
    }
    if (!on) return;
    void this.sendTyping(ref);
    const handle = setInterval(() => { void this.sendTyping(ref); }, 4000);
    this.timers.set(key, handle);
  }

  private async sendTyping(ref: ChannelRef): Promise<void> {
    if (!this.token) return;
    try {
      await this.fetcher(`https://api.telegram.org/bot${this.token}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: Number(ref.conversationId), action: "typing" }),
      });
    } catch {
      // best-effort; intentionally swallowed
    }
  }

  private log(event: TelegramLogEvent): Promise<void> {
    return this.logEntry({ channel: "telegram", ...event });
  }

  private async registerWebhook(publicBaseUrl: string): Promise<void> {
    const url = new URL("/webhooks/telegram", publicBaseUrl).toString();
    await this.fetcher(`https://api.telegram.org/bot${this.token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, secret_token: this.secret }),
    });
  }
}
