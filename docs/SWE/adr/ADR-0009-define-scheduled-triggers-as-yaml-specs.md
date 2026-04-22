---
id: ADR-0009
title: Define scheduled triggers as YAML specs
status: accepted
architect: payam-ranjbar
author: Claude Opus 4.7 (1M context)
created: 2026-04-19
decided: 2026-04-19
supersedes: null
superseded_by: null
generated: auto-from-history
---

# ADR-0009: Define scheduled triggers as YAML specs

## Context

Recurring tasks — log rotation, nightly reflection, periodic checks — are a first-class feature. Operators should add, edit, or remove schedules without touching orchestrator code. Worker memory in v0 is session-only (ADR-0002), and some cron outputs should be captured durably without going to a user channel.

## Alternatives Considered

### Alternative 1: Code-defined crons
Schedules declared inline with dispatcher setup. Type-safe but every change requires a rebuild. Rejected for extensibility.

### Alternative 2: Job queue such as BullMQ or agenda
Durable across restarts with retries and back-pressure, but adds Redis as a dependency for a handful of schedules per operator.

### Alternative 3: YAML specs executed by `node-cron` (chosen)
Operators edit workspace files; the orchestrator loads them at startup. No new runtime dependency and the schedule catalogue is inspectable in tree.

## Decision

We will define scheduled triggers as entries in `<workspace>/crons.yaml` and `<workspace>/agents/<name>/crons.yaml`. Each spec carries an id, a 5-field schedule, a target agent, a payload, a `reply_to` (`{ channel, conversationId }` or `null`), and an optional timeout. When `reply_to` is null, the dispatch result is written to `agents/<name>/dreams/<timestamp>.md` — the dream-journal pattern. Otherwise the result is sent through the named channel.

## Consequences

Operators add or change schedules by editing YAML and restarting. Dream-journal files accumulate but are not read back into future turns — deliberate seed data for the explicit-memory upgrade deferred in ADR-0002. Each cron run emits one line to the shared system log (ADR-0010). `node-cron` runs in-process, so schedules stop while the orchestrator is down; there is no catch-up for missed windows. Id uniqueness must be enforced across all files.

## Compliance

Retroactive. Loader and runtime are in `src/orchestrator/triggers/cron.ts`; templates ship a sample at `templates/workspace/crons.yaml`. Tests in `tests/cron.test.ts` cover schedule registration and dispatch.

## Notes

<!-- Max 1000 characters -->
Commit c85035f. `node-cron` v3. The dream-journal output exists today primarily to feed the deferred memory upgrade; if that upgrade slips, reconsider whether writing to disk without any reader is worth the I/O.
