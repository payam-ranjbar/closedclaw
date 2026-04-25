---
id: ADR-0008
title: Ingest Telegram via webhook behind public tunnel
status: superseded
architect: payam-ranjbar
author: Claude Opus 4.7 (1M context)
created: 2026-04-18
decided: 2026-04-18
supersedes: null
superseded_by: ADR-0013
generated: auto-from-history
---

# ADR-0008: Ingest Telegram via webhook behind public tunnel

## Context

Telegram is the first concrete Channel under the framework defined in ADR-0006. Telegram offers two ingest modes: long-polling, where the server calls `getUpdates` repeatedly, or webhook, where Telegram POSTs updates to a public URL. Operators typically run the orchestrator on a laptop or home server behind NAT, so any public-URL choice forces a tunneling story.

## Alternatives Considered

### Alternative 1: Long-polling via `getUpdates`
No inbound ports, no public URL, simplest operator onboarding. But holds a long-lived HTTP connection per process, conflicts with any other poller on the same bot, and pushes state into an event loop rather than a request handler.

### Alternative 2: Both modes selected by config
Maximum flexibility but doubles the channel code and test surface. Rejected as premature for v0.

### Alternative 3: Webhook with a public tunnel (chosen)
Telegram pushes updates to a public URL forwarded by a reverse tunnel. Aligns the channel interface with the mount-based shape of ADR-0006.

## Decision

We will use Telegram's webhook mode. The channel mounts `POST /webhooks/telegram` on the shared Express application, validates the `X-Telegram-Bot-Api-Secret-Token` header, acknowledges with 200 immediately, and submits asynchronously to the IngestBus. At startup, when `PUBLIC_BASE_URL` is set, the channel registers the URL with Telegram via `setWebhook`.

## Consequences

Operators must run a public tunnel; cloudflared is recommended and ships as a Docker sidecar (ADR-0012). Tunnel URL instability briefly points Telegram at a dead URL after restart — motivates named, persistent tunnels. The Channel interface is mount-based (channels receive `app: Application` in context) largely because of this choice; a polling-first framework would have a different shape. Webhook secret validation prevents forged requests; rejects are logged to `system.log` via ADR-0010.

## Compliance

Retroactive. Mount point and secret check are in `src/orchestrator/channels/telegram.ts`. Tests in `tests/telegram.test.ts` cover secret rejection, ingest path, and reply.

## Notes

<!-- Max 1000 characters -->
Commits dc61403, 997cf01. Explicit A/B/C brainstorm; option B chosen. Cloudflared free tier supports persistent named tunnels; ngrok and other reverse tunnels work but are not the default.
