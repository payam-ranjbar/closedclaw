---
id: ADR-0006
title: Route channel and trigger inputs through IngestBus
status: accepted
architect: payam-ranjbar
author: Claude Opus 4.7 (1M context)
created: 2026-04-19
decided: 2026-04-19
supersedes: null
superseded_by: null
generated: auto-from-history
---

# ADR-0006: Route channel and trigger inputs through IngestBus

## Context

User input may arrive from many transports (Telegram today; Slack, email, web UI, file watchers later) and from timed sources (cron today). The orchestrator needs one integration seam so new sources plug in without modifying the dispatcher, and so channels can participate in bidirectional conversations while triggers stay unidirectional.

## Alternatives Considered

### Alternative 1: Direct channel-to-dispatcher coupling
Each new channel imports the dispatcher directly. Simplest first implementation, but hard-codes routing inside transport code and leaks dispatcher concerns across every channel.

### Alternative 2: Node EventEmitter on the dispatcher
Channels emit, dispatcher subscribes. Workable for one-way flow but provides no structured back-channel for the reply step that bidirectional transports need.

### Alternative 3: Purpose-built IngestBus with Channel and Trigger interfaces (chosen)
One typed seam with explicit `start`, `stop`, and (for channels) `reply` methods. Keeps dispatcher ignorant of transports.

## Decision

We will define two interfaces: `Channel` (bidirectional: `start`, `stop`, `reply`, optional `signalThinking`) and `Trigger` (unidirectional: `start`, `stop`). Both receive a shared `IngestBus`. Every channel message flows through the bus, which always dispatches to the `host` agent first (see ADR-0007) and routes the host's response back through `channel.reply`. Triggers may publish via the bus or call the dispatcher directly.

## Consequences

Adding a new transport requires implementing one interface, not wiring into the dispatcher. Host-first routing makes every routing decision an LLM decision. A `ChannelContext` carries shared dependencies — an Express application, the bus, config, and the system-log writer. Channels that do not need HTTP still receive the Express app — an acceptable coupling for v0. The optional `signalThinking` method lets transports with typing-indicator semantics opt in without forcing an implementation on all channels.

## Compliance

Retroactive. Channel and Trigger interfaces are in `src/orchestrator/channels/index.ts` and `triggers/index.ts`; the bus is `channels/bus.ts`. Test coverage in `tests/bus.test.ts`.

## Notes

<!-- Max 1000 characters -->
Commits cb249e0, 6f111b8, 3512d16. Express 4 is currently in the ChannelContext shape; swapping HTTP frameworks would ripple into every channel. Telegram is the first concrete Channel (ADR-0008); cron is the first concrete Trigger (ADR-0009).
