---
id: ADR-0013
title: Default Telegram ingest to long-polling
status: accepted
architect: payam-ranjbar
author: Claude Opus 4.7 (1M context)
created: 2026-04-21
decided: 2026-04-25
supersedes: ADR-0008
superseded_by: null
---

# ADR-0013: Default Telegram ingest to long-polling

## Context

ADR-0008 chose webhook ingest behind a public tunnel, rejecting long-polling as premature for v0. After shipping, three costs became clear: onboarding requires a Cloudflare account and tunnel token (ADR-0012) before the bot can receive a single message; tunnel URL rotation during restarts leaves Telegram pointing at dead URLs; and the cloudflared sidecar is heavier than Node's own idle long-poll on low-power hosts like a Raspberry Pi. The `ChannelContext` mount shape (ADR-0006) still supports webhook-based channels, so keeping webhook as an opt-in costs little.

## Alternatives Considered

### Alternative 1: Keep webhook-only, add quick-tunnel auto-spawn
Spawn `cloudflared --url` at boot and re-register the webhook on every start with the random `trycloudflare.com` URL. Solves onboarding but adds a second process, rotation-aware lifecycle, and depends on Cloudflare's explicitly-unsupported quick-tunnel endpoint.

### Alternative 2: Remove webhook entirely
Smallest surface area but forfeits the mount-based framework fit and forces a reversal when a push-only channel (WhatsApp, Slack) is added.

### Alternative 3: Polling default, webhook kept as advanced opt-in (chosen)
Add long-polling as the zero-config path while keeping webhook code, tests, and the cloudflared sidecar available behind `TELEGRAM_INGEST_MODE=webhook` and an opt-in Docker Compose profile.

## Decision

We will default Telegram ingest to long-polling via `getUpdates`, and keep webhook mode as an explicit opt-in via `TELEGRAM_INGEST_MODE=webhook`. The `TelegramChannel` selects mode at `start()`: polling mode calls `deleteWebhook` then runs an in-process poll loop; webhook mode mounts the existing route and calls `setWebhook` as before. The Express server binds lazily — `127.0.0.1` by default, `0.0.0.0` only when a channel marks a mounted route as public.

## Consequences

Operators reach a working Telegram bot with only `TELEGRAM_BOT_TOKEN` set; no public URL, tunnel, or secret required. The reference `docker-compose.yml` drops `cloudflared` from default services and moves it behind a `webhook` profile, amending but not superseding ADR-0012's container-image decision. Polling holds one long-lived outbound HTTPS connection per process, which conflicts with running two orchestrators against the same bot token. On crash, at-least-once delivery is possible for the in-flight batch; idempotency remains a dispatcher concern. Future push-only channels will re-exercise the webhook path and the public branch of the lazy-bind logic.

## Compliance

`tests/telegram.test.ts` covers both modes via a `modeOverride` injection, and a new `tests/server-bind.test.ts` verifies the lazy-bind rules. PR review must check that `docker-compose.yml` does not reintroduce cloudflared into the default service list.

## Notes

<!-- Max 1000 characters -->
Brainstormed 2026-04-21. Spec at `docs/superpowers/specs/2026-04-21-telegram-polling-default-design.md`. OpenClaw ships polling-default for the same onboarding reasons; their webhook mode has had restart-loop bugs (openclaw issue #24023). Revisit webhook retention after ~3 months of usage signal — if no operator opts in, consider full removal in a follow-up ADR.
