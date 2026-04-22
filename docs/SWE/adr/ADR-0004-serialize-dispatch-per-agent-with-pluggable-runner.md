---
id: ADR-0004
title: Serialize dispatch per agent with pluggable runner
status: accepted
architect: payam-ranjbar
author: Claude Opus 4.7 (1M context)
created: 2026-04-19
decided: 2026-04-19
supersedes: null
superseded_by: null
generated: auto-from-history
---

# ADR-0004: Serialize dispatch per agent with pluggable runner

## Context

Multiple inputs — channels, triggers, host delegations — can target the same or different workers simultaneously. `claude --resume <sid>` cannot be invoked twice in parallel on the same session; concurrent resumes corrupt session state (ADR-0002 makes sessions load-bearing). The dispatch layer also needs to support a future MCP-stdio transport without rewriting the queueing logic.

## Alternatives Considered

### Alternative 1: Global mutex across all dispatches
Simplest to reason about, but forecloses cross-agent parallelism. Workers are I/O-bound on the LLM, so serializing independent agents wastes throughput.

### Alternative 2: Monolithic dispatcher hard-coded to spawn `claude`
Fewer seams and faster to ship, but the planned v1 MCP transport would require rewriting concurrency and transport logic in tandem.

### Alternative 3: Per-agent FIFO queue behind a Runner interface (chosen)
Different agents run in parallel; same-agent dispatches serialize. Transport lives behind a single-method Runner, swappable without touching the queue.

## Decision

We will split dispatch into three layers: a pure contract (types plus `Runner` interface), a core dispatcher (per-agent queues, single-flight mutex, timeouts), and a runner (the only layer that knows about subprocesses). Each agent gets a FIFO queue with default depth 10 and a single in-flight slot; default timeout is 300 seconds. Tests substitute fake runners at the contract seam.

## Consequences

Session corruption from parallel resumes is structurally impossible. Cross-agent parallelism is preserved. A v1 MCP-stdio runner can replace the subprocess runner without changing core. Same-agent callers may wait when the queue is busy and will be rejected when depth exceeds the cap. The per-agent invariant is called out in CLAUDE.md as mandatory — future contributors must not weaken it. Timing-sensitive tests under full-suite load are a known fragility.

## Compliance

Retroactive. The `Runner` interface is in `src/orchestrator/dispatch/contract.ts`; the per-agent invariant is enforced in `core.ts` and covered by `tests/dispatch-core.test.ts`.

## Notes

<!-- Max 1000 characters -->
Commits 9f21354, 3065166, 2d52837. A pluggable AI-driver abstraction above Runner was discussed but explicitly deferred — the current seam is considered sufficient until a second concrete driver (API-based or non-Claude CLI) exists.
