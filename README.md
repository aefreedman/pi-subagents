# Pi Subagents

Pi extension package for delegated specialist workflows.

For a deeper implementation and runtime walkthrough, see `EXPLAINER.md`.

## What this package provides

- tool: `subagent`
- tool: `subagent_list`
- bundled fallback agent: `general`
- skill: `using-subagents`

## Intended audience

This README is for the human installing or maintaining the package.

Use the `using-subagents` skill for host/orchestrator guidance such as:
- when to use `scout` vs `general`
- how to shape delegated tasks so they stay bounded
- when to use single, parallel, or chain delegation

## Discovery model

`pi-subagents` can discover agents from:
- user-global local agent definitions in `~/.pi/agent/agents/`
- user-global package agent directories registered by installed packages
- its own bundled package agents, including `general`
- project-local agent definitions in `.pi/agents/`
- additional project-declared agent directories from `.pi/subagents.json`
- project-local package agent directories registered by project-installed packages

## Package agent contract

Pi packages do not natively expose `agents/` directories.

This package supports a small package-agent contract:
- canonical agent definitions stay as Markdown files under `agents/`
- a package ships a tiny extension that registers its `agents/` directory at runtime
- `pi-subagents` discovers those registered package directories and classifies them as user-global or project-scoped based on install context

Recommended package shape:

```text
my-agent-package/
  package.json
  agents/
    scout.md
  extensions/
    register-subagents.ts
```

Discovery precedence is:
1. project-local `.pi/agents/`
2. project-local `.pi/subagents.json` paths
3. project-installed package agent dirs
4. user-global `~/.pi/agent/agents/`
5. user-installed package agent dirs

Displayed source tags distinguish at least:
- `project-local`
- `project-config-path`
- `project-package`
- `user-local`
- `user-package`

## Optional agent frontmatter

Supported optional frontmatter fields:
- `class`
  - prompt-shaping hint such as `research`, `review`, `workflow`, `planning`, or `implementation`
- `output_format`
  - current validation targets: `markdown_sections` and `json`
- `required_sections`
  - comma-separated or array form; validates required markdown section names in final output
- `strictness`
  - `low`, `medium`, or `high`; changes how firmly the shared prompt frames the deliverable

Example:

```md
---
name: scout
description: Bounded repository reconnaissance for low-complexity discovery tasks.
tools: read, grep, find, ls
model: openai-codex/gpt-5.3-codex-spark
class: research
output_format: markdown_sections
required_sections: Findings, Key Files, Stop Reason, Recommended Next Slice
strictness: high
---
```

## License

MIT. See `LICENSE`.
