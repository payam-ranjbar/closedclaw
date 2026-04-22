---
id: ADR-0011
title: Scaffold workspaces from bundled templates
status: accepted
architect: payam-ranjbar
author: Claude Opus 4.7 (1M context)
created: 2026-04-19
decided: 2026-04-19
supersedes: null
superseded_by: null
generated: auto-from-history
---

# ADR-0011: Scaffold workspaces from bundled templates

## Context

A new operator needs a coherent default workspace: a router agent (`host`, ADR-0007), at least one worker, hook wiring (ADR-0010), and a cron sample (ADR-0009). First-run friction is a product concern — after `npm install -g closedclaw`, the operator wants a working environment in one command. The workspace sits outside the package install (ADR-0001).

## Alternatives Considered

### Alternative 1: In-code template strings
Emit the file tree from TypeScript string literals. Maximum control but every template edit requires a rebuild and hides the file layout from operators browsing the source.

### Alternative 2: Fetch-from-github at init time
Always current with the main branch, but adds a network dependency to first-run and tagged versions drift from the installed CLI.

### Alternative 3: Directory copied from bundled `templates/` (chosen)
Shipped inside the npm package, editable as plain files in the repo, inspectable before install.

## Decision

We will scaffold workspaces via `closedclaw init`, copying `templates/workspace/` and per-agent trees under `templates/agents/<host|backend-dev|frontend-dev>/` into the resolved workspace. Placeholders `{{WORKSPACE}}` and `{{NOW}}` are substituted at copy time, with backslashes JSON-escaped so Windows paths produce valid JSON in `agents.json`. Default roster: `host` (router), `backend-dev` (with `api-writer` and `migration-writer` grandchildren), and `frontend-dev` (with `component-writer` and `style-writer`).

## Consequences

Package upgrades do not overwrite operator edits — templates are copied once and thereafter owned by the operator. Grandchild subagent definitions give workers a ready-made Agent-tool context; shipping an empty `.claude/agents/` would leave native delegation broken. Adding new agents at runtime uses `closedclaw add-agent`, which copies a minimal subset. Template improvements reach existing workspaces only through manual merge.

## Compliance

Retroactive. `src/commands/init.ts` performs the copy and placeholder substitution; `templates/` is whitelisted in `package.json` `files`. Tests in `tests/init-command.test.ts` cover substitution and Windows path escaping.

## Notes

<!-- Max 1000 characters -->
Commits bf13776, aa156c1, 28b1e83. The frontend grandchildren were added after a review flagged that shipping with none left a freshly-initialized frontend worker without a functional Agent-tool roster. The operator-owns-workspace boundary is the same line drawn in ADR-0003 for state files.
