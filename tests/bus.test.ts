import { describe, it, expect } from "vitest";
import { createIngestBus } from "../src/orchestrator/channels/bus.js";
import type { Channel, ChannelRef } from "../src/orchestrator/channels/index.js";
import type { Dispatcher } from "../src/orchestrator/dispatch/core.js";
import type { DispatchRequest, DispatchResult } from "../src/orchestrator/dispatch/contract.js";

function fakeDispatcher(result: DispatchResult): Dispatcher {
  return { dispatch: async (_: DispatchRequest) => result };
}

function fakeChannel(name: string): { channel: Channel; replies: { ref: ChannelRef; text: string }[] } {
  const replies: { ref: ChannelRef; text: string }[] = [];
  const channel: Channel = {
    name,
    start: async () => {},
    stop: async () => {},
    reply: async (ref, text) => { replies.push({ ref, text }); },
  };
  return { channel, replies };
}

describe("IngestBus", () => {
  it("dispatches to host and replies with the result text on success", async () => {
    const d = fakeDispatcher({
      ok: true, agent: "host", sessionId: "s", result: "answer",
      durationMs: 10, queuedMs: 0,
    });
    const { channel, replies } = fakeChannel("telegram");
    const bus = createIngestBus({ dispatcher: d, channels: new Map([["telegram", channel]]) });
    await bus.submit({ channel: "telegram", conversationId: "42" }, "hi");
    expect(replies).toHaveLength(1);
    expect(replies[0].text).toBe("answer");
  });

  it("replies with a structured error string on failure", async () => {
    const d = fakeDispatcher({
      ok: false, agent: "host", sessionId: "",
      error: { code: "WORKER_BUSY", message: "queue full" },
      durationMs: 0, queuedMs: 0,
    });
    const { channel, replies } = fakeChannel("telegram");
    const bus = createIngestBus({ dispatcher: d, channels: new Map([["telegram", channel]]) });
    await bus.submit({ channel: "telegram", conversationId: "42" }, "hi");
    expect(replies[0].text).toMatch(/WORKER_BUSY/);
  });
});
