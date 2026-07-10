# Changelog

## 0.6.1 - 2026-07-10

### Changed

- Migrated Pi core extension imports and peer dependencies to the `@earendil-works` package scope.

## 0.6.0 - 2026-07-09

### Changed

- Project-agent execution now honors Pi project trust, caches one fallback approval or denial per canonical project root/session, and treats `confirmProjectAgents` as fallback-confirmation control rather than a trust bypass.

### Fixed

- Deny untrusted project-agent execution when interactive confirmation is unavailable instead of silently skipping the guard.

## 0.5.0 - 2026-07-09

### Added

- Added macOS CI coverage for tests and package validation.
- Added optional call-wide and per-task model/thinking selections for single, parallel, and chain delegation, with exact available-model validation and an opt-in `subagent_list` model catalog.

### Changed

- Unpinned agents now inherit both the parent model and Pi thinking level; hard frontmatter model pins still win, and result details expose selection sources.

### Fixed

- Escalate aborted child processes from SIGTERM to SIGKILL only when they have not settled through `close` or `error`, and clean up lifecycle listeners and timers on settlement.
- Explain fallback `pi` executable launch failures with the attempted command and PATH remediation.

## 0.4.0 - 2026-07-09

### Changed

- Hardened the bundled `general` fallback around delegation authority, destructive/external actions, validation, and completion reporting.
- Added an available package root to delegation packets so package agents can locate on-demand references.

### Added

- Added non-fatal discovery diagnostics for unsupported frontmatter fields and empty or malformed `tools` declarations, surfaced compactly by `subagent_list` and fully in its result details.

## 0.3.0 - 2026-07-09

### Changed

- Improved subagent result rendering with compact, aligned per-agent performance stats, including elapsed time, tool count, token/cache usage, cache hit rate, cost, context size, and the complete model point version/subtype.
- Unpinned subagents now inherit the parent session's active provider/model; agent frontmatter can still explicitly pin an exact model.

## 0.2.2 - 2026-06-26

### Changed

- Show the names of currently running subagents in parallel and aggregate running displays.
- Show completed agent names separately while aggregate subagent work is still running.
