# Smoke tests (manual)

## Prerequisites
- `claude` CLI installed, `claude login` completed on host.
- A Telegram bot token in `.env`.
- `cloudflared` tunnel pointing to your local port 3000 (or equivalent).

## S1 — init + doctor green
```
rm -rf ~/.closedclaw
npm run build
node dist/cli.js init
node dist/cli.js doctor
```
Expected: every check reports PASS.

## S2 — Telegram end-to-end
1. `node dist/cli.js start`
2. From Telegram, send: "I need an API for user signup."
3. Watch `~/.closedclaw/system.log` (`tail -f`).
4. Expect lines: `SessionStart` (host) → `UserPromptSubmit` → `SessionStart` (backend-dev, via Bash-delegation) → `Stop` (backend-dev) → `Stop` (host).
5. Bot replies in Telegram with a short summary.
6. `~/.closedclaw/agents.json` — `host.sessionId` and `backend-dev.sessionId` are non-null.

## S3 — cron dream
1. Edit `~/.closedclaw/agents/backend-dev/crons.yaml`: change schedule to `* * * * *`.
2. Restart.
3. Wait 60s.
4. Check `~/.closedclaw/agents/backend-dev/dreams/` for a new `.md` file.
5. Revert schedule.

## S4 — WORKER_BUSY
1. From Telegram, send 12 messages in ~2 seconds (e.g. "msg 1", "msg 2", …).
2. At least one reply should say the worker is busy — the host saw WORKER_BUSY and handled it.

## S5 — Docker parity
```
docker compose up -d
docker compose exec closedclaw closedclaw init
docker compose restart closedclaw
```
Repeat S2 through the Docker deployment.
