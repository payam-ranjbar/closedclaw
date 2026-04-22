---
id: ADR-0012
title: Ship container image with Cloudflare tunnel sidecar
status: accepted
architect: payam-ranjbar
author: Claude Opus 4.7 (1M context)
created: 2026-04-19
decided: 2026-04-19
supersedes: null
superseded_by: null
generated: auto-from-history
---

# ADR-0012: Ship container image with Cloudflare tunnel sidecar

## Context

Webhook ingest (ADR-0008) requires a public URL even when the orchestrator runs on a laptop behind NAT. Operators less comfortable with npm still need a one-command path. Claude CLI authentication lives in `~/.claude`; any container must reuse host credentials rather than re-authenticate inside the image.

## Alternatives Considered

### Alternative 1: Host-install only, no container
Simplest build story, but leaves operators to solve the public-URL problem themselves and excludes audiences uncomfortable with npm-global.

### Alternative 2: Alpine-based image
Smaller surface, but `claude` and git are glibc-linked and hit musl friction; size savings do not justify the troubleshooting cost.

### Alternative 3: Multi-stage `node:20-slim` with cloudflared sidecar (chosen)
Self-contained image with compatible runtime, plus an integrated tunnel via docker-compose. Operators reach a working webhook in one `docker compose up`.

## Decision

We will ship a multi-stage Dockerfile: a `node:20-slim` builder runs `npm ci && npm run build`; the runtime stage installs bash, git, curl, ca-certificates, and `@anthropic-ai/claude-code` globally, then `npm link`s the package so `closedclaw` is on PATH. The container runs as a non-root `agent` user with configurable UID and GID, mounts `/workspace` and `/home/agent/.claude`, and exposes port 3000. The reference `docker-compose.yml` adds a `cloudflared` sidecar and declares `depends_on: cloudflared` so the tunnel is up before webhook registration.

## Consequences

Operators choose between npm-global (ADR-0001) and Docker; both are first-class. Claude credentials bind-mount from the host, avoiding re-login. `claude` CLI is baked into the image, so version bumps require rebuild. UID and GID parameterization avoids permission pain on bind mounts. Operators can swap cloudflared for ngrok or a raw tunnel.

## Compliance

Retroactive. The Dockerfile and `docker-compose.yml` live at the repo root; `.dockerignore` excludes state, tests, and dev files. No automated CI image build exists yet.

## Notes

<!-- Max 1000 characters -->
Commits 34157f7, 997cf01. Cloudflared free tier supports persistent named tunnels that survive restarts; the README documents ngrok as an acceptable alternative. No image-publish pipeline is in place — `docker compose up --build` is the supported flow.
