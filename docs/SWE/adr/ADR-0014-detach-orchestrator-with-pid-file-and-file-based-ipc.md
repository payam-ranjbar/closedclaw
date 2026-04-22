---
id: ADR-0014
title: Detach orchestrator with PID file and file-based IPC
status: proposed
architect: payam-ranjbar
author: Claude Opus 4.7 (1M context)
created: 2026-04-21
decided: null
supersedes: null
superseded_by: null
---

# ADR-0014: Detach orchestrator with PID file and file-based IPC

## Context

`closedclaw start` currently blocks the operator's terminal, and `closedclaw status` only reports agent registry state. Operators need to background the daemon, ask whether it is running, tail the live event stream, and stop it cleanly. The tool targets Linux, macOS, Windows, and resource-constrained VPS/Raspberry Pi deployments, with no new runtime dependencies permitted by project norms. Express already runs for the Telegram webhook and `system.log` already carries a JSONL event stream (ADR-0010).

## Alternatives Considered

### Alternative 1: External process manager (PM2, forever, node-windows)
Mature daemonization, restart policies, and log handling out of the box. Introduces a runtime dependency and a second install step; duplicates ~50 lines of code we can own.

### Alternative 2: OS service installer (systemd, launchd, winsw)
Robust boot-time integration and per-OS conventions. Platform-specific install UX and privileged operations; heavyweight for a single-user dev tool.

### Alternative 3: Lockfile-based liveness (proper-lockfile)
OS releases the lock on crash on Unix. On Windows the library falls back to `mkdir` plus mtime heartbeats, giving a stale-after-Ns window rather than true release-on-crash. Adds a dependency for a marginal gain over `process.kill(pid, 0)`.

### Alternative 4: HTTP liveness probe on the existing Express port
Zero new dependencies. Reports "not running" when the port failed to bind even though the process is alive, and couples correctness to Express remaining part of the boot path.

## Decision

We will daemonize `closedclaw start` by default through a detached self-spawn of a hidden `__daemon` subcommand, recording the child PID in `$workspace/state/closedclaw.pid` written with `O_EXCL` to defend against concurrent starts. Liveness routes through a single `isDaemonAlive()` seam that uses `process.kill(pid, 0)` so the implementation can switch to port-probe or lockfile later without touching callers. Observability stays strictly file-based: `closedclaw log` tails `system.log`, and the daemon's stdout and stderr spill to `$workspace/logs/daemon.out` and `daemon.err` as a safety net for crashes that bypass the structured logger.

## Consequences

- `closedclaw start` is idempotent: a live daemon makes it print "already running (pid N)" and exit 0.
- Runtime dependency set is unchanged — no lockfile library, no SSE, no sockets.
- `start` waits up to 2 s for the child to stabilize so bad-config failures surface immediately with a tail of `daemon.err`, rather than the caller seeing a phantom "running" message.
- On Windows, `process.kill(pid, 'SIGTERM')` is `TerminateProcess`. The daemon cannot run cleanup; the PID file may linger and gets reaped by the next `start`. This aligns with the existing CLAUDE.md note that SIGTERM does not drain in-flight dispatches.
- PID recycling remains a theoretical hole. Accepted for v0 on single-operator boxes; escape hatch is `rm $workspace/state/closedclaw.pid`.
- Log rotation and rendering of the host claude transcript are explicitly out of scope and deferred to separate future ADRs.

## Compliance

PR review verifies that all liveness checks route through `isDaemonAlive()` in `src/orchestrator/daemon.ts` — no direct `kill(0)` or PID-file reads in command handlers. Vitest suites (`tests/daemon.test.ts`, `tests/start.test.ts`, `tests/stop.test.ts`, `tests/log.test.ts`) enforce the contract without spawning the real CLI, matching the CLAUDE.md rule against running `closedclaw start` from Claude sessions.

## Notes

<!-- Max 1000 characters -->
Design resolved four calls: D1 concurrent-start race defended with `O_EXCL` placeholder write; D2 stabilization window of 2 s before `start` reports success; D3 `stop` waits 5 s for SIGTERM, `--force` adds SIGKILL; D4 Windows hard-kill semantics accepted rather than building a file-based shutdown handshake. If in-flight drain becomes important, supersede with a shutdown-handshake ADR. Full design spec: `docs/superpowers/specs/2026-04-21-daemonize-and-log-design.md`.
