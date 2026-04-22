---
id: ADR-0005
title: Execute workers as `claude` CLI subprocesses
status: accepted
architect: payam-ranjbar
author: Claude Opus 4.7 (1M context)
created: 2026-04-19
decided: 2026-04-19
supersedes: null
superseded_by: null
generated: auto-from-history
---

# ADR-0005: Execute workers as `claude` CLI subprocesses

## Context

A worker turn needs Claude's tool loop, hook dispatching, subagent orchestration, and persistent session resume. The operator already has a Claude subscription and the `claude` CLI installed. Two routes exist: drive the Anthropic API directly, or shell out to the same `claude` CLI a human would use.

## Alternatives Considered

### Alternative 1: Anthropic SDK
Direct API control and lower per-turn latency, but we would re-implement the tool loop, hook dispatching, subagent nesting, and `--resume` semantics — all of which `claude` already ships. Forces a separate auth story.

### Alternative 2: Embedded Agent SDK server
Similar cost to the SDK route. Gains a canonical tool loop but splits auth from the operator's existing subscription.

### Alternative 3: Shell out to `claude` (chosen)
Reuses operator auth, hooks, subagents, and `--resume` for free. Subprocess-boot latency is acceptable at dispatch scale.

## Decision

We will spawn the `claude` CLI as a subprocess for every worker dispatch. The runner passes the payload via `-p`, requests `--output-format stream-json --verbose`, and parses NDJSON to extract `session_id` and `result`. The subprocess always runs with `--permission-mode bypassPermissions` because in headless `-p` mode any denied tool call causes `claude` to exit 0 with no result event, surfacing as an unhelpful crash.

## Consequences

Workers inherit the full Claude toolbox without reimplementation. bypassPermissions removes approval prompts — workers run with full tool access within their per-agent cwd, an explicit trust boundary: the operator owns the machine and workers only see their own directory. An expired OAuth token fails silently at first dispatch; `doctor` cannot detect it. If `claude` changes its stream-json shape, the runner breaks. Subprocess invocation uses `cross-spawn` to tolerate Windows `.cmd` shims and the CVE-2024-27980 mitigation.

## Compliance

Retroactive. All runner argv assembly lives in `src/orchestrator/dispatch/runner.ts`. Stream parsing and timeout behavior are covered by `tests/runner.test.ts`.

## Notes

<!-- Max 1000 characters -->
Commits 2d52837, bbfa03c, 5a735c5. bypassPermissions is documented in CLAUDE.md as the only way to keep headless dispatch reliable. The trust model is local-only and may need revisiting if workers ever become remote-executed.
