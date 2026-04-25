# closedclaw

A small Node app that runs a group of Claude Code agents on your machine. You message it on Telegram, it picks the right agent for your request, and replies back.

## What you need

- Node 20 or newer
- The claude CLI installed and logged in
- A Telegram bot token (get one from @BotFather)

## Setup

```
npm install -g closedclaw
closedclaw init
```

Open `~/.closedclaw/.env` and fill in `TELEGRAM_BOT_TOKEN`.

```
closedclaw doctor
closedclaw start
```

Send your bot a message. That's it.

## Adding a new agent

```
closedclaw add-agent my-agent
```

Then open `~/.closedclaw/agents/my-agent/CLAUDE.md` and describe what the agent does.

## Docker

```
cp .env.example .env   # then fill in TELEGRAM_BOT_TOKEN
docker compose up
```

## Running behind a public URL (advanced)

For multi-instance deployments, lower-latency burst traffic, or push-native channels added later, set `TELEGRAM_INGEST_MODE=webhook` and `PUBLIC_BASE_URL` in `.env`, expose port 3000 via your own tunnel (cloudflared, ngrok, …), and run:

```
docker compose --profile webhook up
```

The `cloudflared` sidecar in `docker-compose.yml` activates only on this profile and reads `CLOUDFLARE_TUNNEL_TOKEN` from `.env`.

## Architecture

Key architectural decisions are documented in [`docs/SWE/adr/`](docs/SWE/adr/).

| ADR | Decision | Status |
|-----|----------|--------|
| [ADR-0001](docs/SWE/adr/ADR-0001-run-as-single-process-operator-local-orchestrator.md) | Run as single-process operator-local orchestrator | Accepted |
| [ADR-0002](docs/SWE/adr/ADR-0002-model-workers-as-persistent-claude-sessions.md) | Model workers as persistent Claude sessions | Accepted |
| [ADR-0003](docs/SWE/adr/ADR-0003-persist-agent-registry-as-atomic-flat-file.md) | Persist agent registry as atomic flat-file store | Accepted |
| [ADR-0004](docs/SWE/adr/ADR-0004-serialize-dispatch-per-agent-with-pluggable-runner.md) | Serialize dispatch per agent with pluggable runner | Accepted |
| [ADR-0005](docs/SWE/adr/ADR-0005-execute-workers-as-claude-cli-subprocesses.md) | Execute workers as `claude` CLI subprocesses | Accepted |
| [ADR-0006](docs/SWE/adr/ADR-0006-route-channel-and-trigger-inputs-through-ingestbus.md) | Route channel and trigger inputs through IngestBus | Accepted |
| [ADR-0007](docs/SWE/adr/ADR-0007-delegate-routing-to-host-agent-via-cli-subcommand.md) | Delegate routing to host agent via CLI subcommand | Accepted |
| [ADR-0008](docs/SWE/adr/ADR-0008-ingest-telegram-via-webhook-behind-public-tunnel.md) | Ingest Telegram via webhook behind public tunnel | Accepted |
| [ADR-0009](docs/SWE/adr/ADR-0009-define-scheduled-triggers-as-yaml-specs.md) | Define scheduled triggers as YAML specs | Accepted |
| [ADR-0010](docs/SWE/adr/ADR-0010-emit-jsonl-telemetry-via-claude-hooks.md) | Emit JSONL telemetry via Claude hooks | Accepted |
| [ADR-0011](docs/SWE/adr/ADR-0011-scaffold-workspaces-from-bundled-templates.md) | Scaffold workspaces from bundled templates | Accepted |
| [ADR-0012](docs/SWE/adr/ADR-0012-ship-container-image-with-cloudflare-tunnel-sidecar.md) | Ship container image with Cloudflare tunnel sidecar | Accepted |

_12 architectural decisions recorded. Last updated: 2026-04-21._
