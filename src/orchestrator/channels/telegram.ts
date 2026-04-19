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

export class TelegramChannel implements Channel {
  readonly name = "telegram";
  private secret = "";
  private token = "";
  private fetcher: Fetcher;

  constructor(private readonly opts: Options = {}) {
    this.fetcher = opts.fetcher ?? fetch;
  }

  async start(ctx: ChannelContext): Promise<void> {
    this.token = ctx.config.token ?? process.env.TELEGRAM_BOT_TOKEN ?? "";
    this.secret = this.opts.secretOverride
      ?? ctx.config.secret
      ?? process.env.TELEGRAM_WEBHOOK_SECRET
      ?? "";

    ctx.app.post("/webhooks/telegram", express.json(), async (req, res) => {
      if (req.header("x-telegram-bot-api-secret-token") !== this.secret) {
        res.status(401).json({ ok: false });
        return;
      }
      const body = req.body as TelegramUpdate;
      if (!body?.message?.text || !body.message.chat?.id) {
        res.json({ ok: true });
        return;
      }
      const ref: ChannelRef = {
        channel: "telegram",
        conversationId: String(body.message.chat.id),
        userId: body.message.from ? String(body.message.from.id) : undefined,
        raw: body,
      };
      res.json({ ok: true });
      ctx.bus.submit(ref, body.message.text).catch((err) => {
        console.error("telegram ingest failed:", err);
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

  private async registerWebhook(publicBaseUrl: string): Promise<void> {
    const url = new URL("/webhooks/telegram", publicBaseUrl).toString();
    await this.fetcher(`https://api.telegram.org/bot${this.token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, secret_token: this.secret }),
    });
  }
}
