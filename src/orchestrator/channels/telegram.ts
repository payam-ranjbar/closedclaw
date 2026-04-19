import express from "express";
import { fetch } from "undici";
import type { Channel, ChannelContext, ChannelRef } from "./index.js";

type Fetcher = typeof fetch;

interface Options {
  fetcher?: Fetcher;
  secretOverride?: string;
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
  private logEntry: ChannelContext["log"] = async () => {};

  constructor(private readonly opts: Options = {}) {
    this.fetcher = opts.fetcher ?? fetch;
  }

  async start(ctx: ChannelContext): Promise<void> {
    this.token = ctx.config.token ?? process.env.TELEGRAM_BOT_TOKEN ?? "";
    this.secret = this.opts.secretOverride
      ?? ctx.config.secret
      ?? process.env.TELEGRAM_WEBHOOK_SECRET
      ?? "";
    this.logEntry = ctx.log;

    ctx.app.post("/webhooks/telegram", express.json(), async (req, res) => {
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
    });

    if (ctx.config.publicBaseUrl && this.token) {
      await this.registerWebhook(ctx.config.publicBaseUrl);
    }
  }

  async stop(): Promise<void> {}

  async reply(ref: ChannelRef, text: string): Promise<void> {
    if (!this.token) return;
    await this.fetcher(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: Number(ref.conversationId), text }),
    });
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
