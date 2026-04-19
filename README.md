# closedclaw

A small Node app that runs a group of Claude Code agents on your machine. You message it on Telegram, it picks the right agent for your request, and replies back.

## What you need

- Node 20 or newer
- The claude CLI installed and logged in
- A Telegram bot token (get one from @BotFather)
- A public URL pointing at your local port 3000 (a cloudflared tunnel works fine)

## Setup

```
npm install -g closedclaw
closedclaw init
```

Open `~/.closedclaw/.env` and fill in:

```
PORT=3000
PUBLIC_BASE_URL=https://your-public-url
TELEGRAM_BOT_TOKEN=your-bot-token
```

Then:

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

There is a `docker-compose.yml` if you'd rather run it in a container. Copy `.env.example` to `.env`, fill it in, then `docker compose up`.
