# Changelog

## Unreleased

## [0.8.2] - 2026-09-20

### Changed

- Pin development validation dependencies to Pi 0.86.1 while retaining optional wildcard peers for Pi-provided runtime packages.
- Declare and lock the TypeScript test runner so release validation does not fetch an undeclared tool.

## [0.8.1] - 2026-08-08

### Changed

- Centralized delegated-child Pi argument construction and added regression coverage confirming children retain Pi's normal global, project, package, and settings-based skill and extension discovery while trusted project extensions continue to be forwarded explicitly.

## [0.8.0] - 2026-08-05

### Added

- Added trusted project-scoped child extension forwarding through bounded `piSubagents.childExtensions` entries in `.pi/settings.json`; resolved files are passed to delegated Pi processes with explicit `-e` arguments regardless of child working directory.
- Added a tested bounded-review delegation contract: Default mode permits at most one justified specialist, requires root-session focused verification after remediation, and reserves parallel review for distinct concerns with Thorough mode or a user checkpoint.
- Added a versioned session-scoped package-agent registry with immutable snapshots, physical manifest provenance, cross-owner duplicate diagnostics, and stale-token/idempotent cleanup.
- Added isolated-loader, reload, disabled-package, provenance, and no-leakage tests for package-agent discovery and registration.

### Changed

- Removed the `@aefree/pi-workflow` execution-runtime bridge; direct `subagent` delegation remains trust-gated and independently owned by this package.
- Organized runtime implementation under `src/`, moved the public architecture walkthrough under `docs/`, and limited the npm artifact to runtime resources and public package documentation.
- Prepared public npm metadata, registry-resolved dependency locking, cross-platform validation, and resumable trusted-publishing automation.

### Fixed

- Canonicalize physical agent-source paths before duplicate provenance checks so aliases are detected consistently across Windows, macOS, and Linux.
- Validate missing forwarded-extension paths lexically before physical canonicalization so cross-platform path aliases do not misclassify an in-project missing file as an escape.
- Removed packaged-prompt activation policy from delegation guidance; the skill now stays focused on root-session task shaping, review depth, trust, and execution mechanics.
- Attribute the bundled `general` agent directory to the scoped package name `@aefree/pi-subagents`.
- Prevent ordinary Node SDK and test hosts from treating `process.argv[1]` as Pi and recursively spawning themselves.
- Resolve package agents from the invocation's current session scope for listing and trust-gated tool execution.
- Block nested delegation through interactive tools with shared depth propagation and delegated-tool filtering.

## 0.7.0 - 2026-07-24

### Changed

- Restricted subagent model discovery and execution to the available OpenAI Codex GPT-5.6 Luna, Sol, and Terra variants.
- Marked Pi-bundled core dependencies as optional peers so Pi git installs do not create redundant per-package `node_modules` directories.

## 0.6.1 - 2026-07-10

### Changed

- Migrated Pi core extension imports and peer dependencies to the `@earendil-works` package scope.

### Fixed

- Compare canonical package and project roots in discovery tests so macOS `/var` to `/private/var` resolution is handled correctly.

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
