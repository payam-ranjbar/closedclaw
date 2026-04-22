---
id: ADR-0010
title: Emit JSONL telemetry via Claude hooks
status: accepted
architect: payam-ranjbar
author: Claude Opus 4.7 (1M context)
created: 2026-04-19
decided: 2026-04-19
supersedes: null
superseded_by: null
generated: auto-from-history
---

# ADR-0010: Emit JSONL telemetry via Claude hooks

## Context

The orchestrator needs observability across channel ingress, bus dispatch, worker runs with nested subagents (ADR-0005), and cron outcomes (ADR-0009). Workers run as separate Claude subprocesses, so intercepting stdout is partial at best. Operators troubleshoot with `tail -f` and `jq`, arguing for a minimal line-oriented format.

## Alternatives Considered

### Alternative 1: Structured logger (pino, winston)
Rich formatters and log levels, but adds dependency weight for little gain on a single-operator tool where the format itself is the interesting part.

### Alternative 2: OpenTelemetry collector
Appropriate for distributed systems with a central backend, but overkill for a single-process orchestrator with no planned sink.

### Alternative 3: Claude-native hooks emitting JSONL (chosen)
Every worker's `.claude/settings.json` wires lifecycle events to `closedclaw hook <event>`, which appends one line per event to `<workspace>/system.log`.

## Decision

We will emit all observability as JSONL across two streams. `system.log` captures worker hook events (SessionStart, SubagentStart, UserPromptSubmit, Stop, others), channel events via a typed discriminated union (Telegram receive, reply, reject, error), and cron outcomes. `queue.log` captures dispatcher internals (enqueue and dequeue with agent and correlationId). Every line carries an ISO-8601 `ts`. Channel events record `textLength` only — payload text never enters the log. Both writers are best-effort.

## Consequences

Hook commands require `closedclaw` on PATH inside spawned subprocesses — global install (ADR-0001) or `npm link` is a hard prerequisite. Two streams keep mechanical queue noise out of the business-event log. Privacy posture is explicit: message content is not retained. No log rotation is built in; a templated cron performs rotation. Adding a new channel means adding union variants at three to six call sites.

## Compliance

Retroactive. The `appendSystemLog` writer is in `src/orchestrator/server.ts` and is injected into channels, cron, and the hook CLI. Queue-log writes live in `src/orchestrator/dispatch/core.ts`.

## Notes

<!-- Max 1000 characters -->
Commits 36a8074, c85035f, 3512d16, 194f174, 28b1e83. The "no payload text" privacy decision is documented only in staging notes and a gitignored spec — worth surfacing in a privacy policy if the tool ever goes multi-tenant. Human review recommended on privacy claims.
