# Changelog

## 0.3.0 - 2026-07-09

### Changed

- Improved subagent result rendering with compact, aligned per-agent performance stats, including elapsed time, tool count, token/cache usage, cache hit rate, cost, context size, and the complete model point version/subtype.
- Unpinned subagents now inherit the parent session's active provider/model; agent frontmatter can still explicitly pin an exact model.

## 0.2.2 - 2026-06-26

### Changed

- Show the names of currently running subagents in parallel and aggregate running displays.
- Show completed agent names separately while aggregate subagent work is still running.
