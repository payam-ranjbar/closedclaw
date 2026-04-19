# closedclaw

Claude-Code-native agent orchestrator. Route messages from channels (Telegram) and cron triggers to a persistent host Claude Code session that delegates to specialist worker sessions.

## Requirements

- Node.js >= 20
- `claude` CLI installed and logged in (`claude login`)

## Install

```
npm install -g closedclaw
closedclaw init
```

Edit `~/.closedclaw/.env`, then:

```
closedclaw doctor
closedclaw start
```

## Docker

```
claude login
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN, CLOUDFLARE_TUNNEL_TOKEN, PUBLIC_BASE_URL
docker compose up -d
docker compose exec closedclaw closedclaw init
docker compose restart closedclaw
```

## Workspace resolution

1. `--workspace <path>`
2. `CLOSEDCLAW_WORKSPACE`
3. `./workspace/` if present
4. `~/.closedclaw/`

## Commands

- `closedclaw init` — scaffold a workspace
- `closedclaw start` — run the orchestrator
- `closedclaw add-agent <name>` — scaffold a new worker
- `closedclaw status` — show agents + recent telemetry
- `closedclaw doctor` — diagnostics
