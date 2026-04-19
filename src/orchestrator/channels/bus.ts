import type { Channel, ChannelRef, IngestBus } from "./index.js";
import type { Dispatcher } from "../dispatch/core.js";

interface Options {
  dispatcher: Dispatcher;
  channels: Map<string, Channel>;
}

export function createIngestBus(opts: Options): IngestBus {
  return {
    async submit(ref: ChannelRef, text: string): Promise<void> {
      const channel = opts.channels.get(ref.channel);
      if (!channel) return;

      const res = await opts.dispatcher.dispatch({
        agent: "host",
        payload: text,
        origin: { kind: "channel", name: ref.channel },
      });

      const replyText = res.ok
        ? (res.result ?? "")
        : `dispatch failed: ${res.error?.code}: ${res.error?.message}`;

      await channel.reply(ref, replyText);
    },
  };
}
