---
id: ADR-0003
title: Persist agent registry as atomic flat-file store
status: accepted
architect: payam-ranjbar
author: Claude Opus 4.7 (1M context)
created: 2026-04-19
decided: 2026-04-19
supersedes: null
superseded_by: null
generated: auto-from-history
---

# ADR-0003: Persist agent registry as atomic flat-file store

## Context

The orchestrator must remember which workers exist and, critically, each worker's current Claude session_id so dispatches resume the correct session (ADR-0002). Per ADR-0001 the tool runs as a single-writer process, so concurrent-writer protection is unnecessary. The file is load-bearing: losing it means losing all accumulated worker memory permanently.

## Alternatives Considered

### Alternative 1: SQLite
Transactional durability and a mature query layer, but adds a native dependency and a wrapping layer for a registry that holds on the order of ten records with no relational queries.

### Alternative 2: An embedded key-value store (LevelDB, lmdb)
Higher throughput than a flat file. Disproportionate for a registry that updates once per dispatch, and the binary format loses the "operator can inspect it with `cat`" property.

### Alternative 3: Flat JSON file with atomic rename and `.bak` recovery (chosen)
Zero-dependency, human-inspectable, and sufficient for single-writer workloads with write-rate measured in events per minute.

## Decision

We will persist the agent registry as a single `agents.json` file at the workspace root. Writes go via tmp file plus `rename`, with the previous file first copied to `agents.json.bak`. Reads fall back to the backup when the primary is missing or unparseable. No schema migrations are performed; the format evolves through additive fields only.

## Consequences

Operators can debug state by reading the file directly. A disk-full or crash during rename is recoverable from `.bak` on the next read. Concurrency safety relies on the single-process invariant of ADR-0001; multiple writers would corrupt the file. Disaster recovery is whatever the operator's backup strategy for the workspace directory is. Schema changes must remain additive or ship a one-shot migration.

## Compliance

Retroactive. All state reads and writes route through `readAgents` and `writeAgents` in `src/orchestrator/state.ts`. Tests in `tests/state.test.ts` cover the atomic-write and backup-recovery paths.

## Notes

<!-- Max 1000 characters -->
Retroactively generated. Commit 43dad93. The atomic-rename-plus-backup pattern is a well-known idiom for single-writer local state; no ADR-worthy controversy, but the load-bearing nature of `agents.json` for worker memory (per ADR-0002) elevates this file above ordinary configuration.
