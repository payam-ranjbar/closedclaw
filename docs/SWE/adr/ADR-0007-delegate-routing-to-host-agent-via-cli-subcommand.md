---
id: ADR-0007
title: Delegate routing to host agent via CLI subcommand
status: accepted
architect: payam-ranjbar
author: Claude Opus 4.7 (1M context)
created: 2026-04-19
decided: 2026-04-19
supersedes: null
superseded_by: null
generated: auto-from-history
---

# ADR-0007: Delegate routing to host agent via CLI subcommand

## Context

Given the bus in ADR-0006, the orchestrator must decide which worker handles each message. Routing can live in TypeScript (keywords, regex) or in an LLM reasoning about intent. Operators expect to add or rename workers without redeploying code.

## Alternatives Considered

### Alternative 1: TypeScript rule-based router
Fast and deterministic, but every new worker or capability change requires a code edit, a build, and a restart.

### Alternative 2: Lightweight classifier (embeddings, nearest-agent)
Better than keywords but adds a model pipeline, embedding store, and training data to a problem that is fundamentally natural-language reasoning.

### Alternative 3: LLM-as-router (chosen)
A dedicated `host` Claude session whose `CLAUDE.md` describes the worker roster picks a worker per turn. Extending the router means editing a markdown file.

## Decision

We will route every bus message through a `host` agent first. The host reads the message, optionally answers directly, or runs `echo "<refined task>" | closedclaw dispatch <agent>` via its Bash tool to delegate. The `dispatch` CLI subcommand is a hidden entrypoint that reads stdin, calls the dispatcher (ADR-0004), and writes result to stdout or error to stderr. In v0 the transport is Bash invocation; v1 will replace it with an MCP stdio server, absorbed via the Runner seam.

## Consequences

Adding a worker is an edit to the host's `CLAUDE.md` — no orchestrator code change. Every user message costs one extra Claude turn for routing. The host logs routing decisions to its own `memory/routing.jsonl`; the orchestrator never reads that file back. The Bash-via-CLI transport is v0-specific and earmarked for replacement; the Runner abstraction absorbs the swap without touching core dispatch.

## Compliance

Retroactive. The host template is `templates/agents/host/CLAUDE.md`; the CLI entrypoint is `src/commands/dispatch.ts`.

## Notes

<!-- Max 1000 characters -->
Commits 61a0c91, bf13776. MCP transport for v1 is planned but unscheduled — the Bash-over-CLI transport is an intentional stepping stone, not a permanent shape. Expected lifespan of the Bash transport: weeks to months. Re-evaluate this ADR if v1 MCP lands.
