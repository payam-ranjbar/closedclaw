---
id: ADR-0001
title: Run as single-process operator-local orchestrator
status: accepted
architect: payam-ranjbar
author: Claude Opus 4.7 (1M context)
created: 2026-04-18
decided: 2026-04-18
supersedes: null
superseded_by: null
generated: auto-from-history
---

# ADR-0001: Run as single-process operator-local orchestrator

## Context

A single operator runs Claude-Code-native multi-agent workflows on their own machine using their own Claude subscription. The tool is not multi-tenant and has no hosted offering. It must run on Linux, macOS, and Windows from a laptop with no fixed network address.

## Alternatives Considered

### Alternative 1: Multi-service deployment with broker
Dispatcher, channel ingress, and state store as separate services coordinated via Redis or NATS. Horizontal scale out of the box, overwhelming operational surface for one operator.

### Alternative 2: Electron desktop application
Desktop app with embedded UI. Solves onboarding but triples build complexity and forecloses headless deployment.

### Alternative 3: Hosted SaaS
Host centrally and expose over the network. Undercuts the "use your own subscription" goal and introduces multi-tenancy the architecture is not designed for.

## Decision

We will ship ClosedClaw as a single Node process distributed through npm as a global binary, with all mutable operator state in a per-operator workspace directory. Workspace resolution follows a four-tier chain: CLI flag, `CLOSEDCLAW_WORKSPACE` env var, `./workspace/`, then `~/.closedclaw/`. Install and workspace are deliberately separate so upgrades never touch operator state.

## Consequences

One boot path and one lifecycle process simplify the runtime model. Operator state survives package upgrades. Hook commands inside spawned `claude` subprocesses resolve `closedclaw` via PATH — global install or `npm link` is a hard prerequisite for telemetry. Horizontal scale is foreclosed; the architecture assumes a single writer to `agents.json` (ADR-0003). No multi-user auth story is needed in v0.

## Compliance

Retroactive record. Compliance is established by the existing codebase — `package.json` (`bin`, `files`, `engines`) and `src/orchestrator/workspace.ts` encode this decision.

## Notes

<!-- Max 1000 characters -->
Retroactively generated from staged context files and git history. Original decision context may be incomplete. Evidence: commits ee995e7, dc64490, 9f49a6b; README; CLAUDE.md "Big picture". Strict ESM on Node 20+ and Vitest are constraints inherited from the initial bootstrap rather than weighed architectural choices; they are treated as background here.
