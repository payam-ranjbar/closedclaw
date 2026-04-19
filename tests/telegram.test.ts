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
  let app: express.Express;
  let server: Server;
  let port: number;
  const secret = "test-secret";

  beforeEach(async () => {
    ({ app, server, port } = await startApp());
    submitted = [];
    const bus = { submit: async (ref: ChannelRef, text: string) => { submitted.push({ ref, text }); } };
    const channel = new TelegramChannel({
      fetcher: async () => new Response("{}"),
      secretOverride: secret,
    });
    await channel.start({ app, bus, config: { token: "bot-token", publicBaseUrl: "https://x.example" } });
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
});
