---
id: ADR-0002
title: Model workers as persistent Claude sessions
status: accepted
architect: payam-ranjbar
author: Claude Opus 4.7 (1M context)
created: 2026-04-18
decided: 2026-04-18
supersedes: null
superseded_by: null
generated: auto-from-history
---

# ADR-0002: Model workers as persistent Claude sessions

## Context

The product value depends on long-lived specialist agents that accumulate context over days, not fresh assistants per request. Claude Code exposes two primitives that can host a worker: server-side sessions continued via `--resume <session_id>`, or subagent definitions invoked by a parent's Agent tool. The choice shapes worker topology and memory semantics.

## Alternatives Considered

### Alternative 1: One host session with workers as subagent definitions
Workers become `.md` files in a single host session's `.claude/agents/`. Lightweight but subagents hold no state between calls, cannot host their own sub-subagents meaningfully, and cannot accumulate memory across days.

### Alternative 2: Stateless fan-out
Spawn `claude -p` per webhook with no resume. Simplest dispatch path but every turn starts from zero and destroys the accumulated-context value proposition.

### Alternative 3: Persistent per-worker sessions (chosen)
Each worker is a Claude session with its own cwd, CLAUDE.md, hooks, and session_id. Heaviest setup per worker but matches the long-lived specialist model.

## Decision

We will model each worker as its own persistent Claude session, resumed on every dispatch via `--resume <session_id>`. For v0, worker memory is whatever Claude's server-side session state holds — the orchestrator writes no explicit memory files, performs no summarization, and does not read back dream-journal output. Explicit memory files are deferred to v0.2.

## Consequences

Worker context accumulates naturally across turns. `agents.json` becomes load-bearing — losing it wipes all worker memory. Session context grows until Claude's auto-compaction triggers, which is lossy; a month-old worker may forget conventions set in week one. Each worker holds its own `.claude/settings.json` and directory, enabling per-worker hooks (ADR-0010) and grandchild subagents. This forces per-agent serialization of `--resume` (ADR-0004).

## Compliance

Retroactive. Compliance is established by `AgentRecord.sessionId` in `src/orchestrator/state.ts` and the `--resume` wiring in `src/orchestrator/dispatch/runner.ts`.

## Notes

<!-- Max 1000 characters -->
Retroactively generated from conversation logs and code evidence. The v0 memory strategy has a planned expiry: explicit memory files per worker are tracked for v0.2 but unscheduled. Evidence is partly conversational (user choice between R2-full, R2-lite, and stateless fan-out); human review recommended. Commits ee995e7, 43dad93, 2d52837.
