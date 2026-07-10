# Pi Subagents

Pi extension package for delegated specialist workflows.

For a deeper implementation and runtime walkthrough, see `EXPLAINER.md`.

## What this package provides

- tool: `subagent`
- tool: `subagent_list`
- bundled fallback agent: `general`
- skill: `using-subagents`

## Intended audience

This README is for humans installing or maintaining the package. Use the `using-subagents` skill for host/orchestrator guidance such as:

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
- a package ships a small extension that registers its `agents/` directory at runtime
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

## Install

From GitHub:

```bash
pi install git:git@github.com:aefreedman/pi-subagents.git
```

Local development install:

```bash
pi install <path-to-pi-subagents>
```

Project-local install:

```bash
pi install -l <path-to-pi-subagents>
```

## Model and thinking selection

Unpinned agents inherit the parent session's provider/model and Pi thinking level by default. Before selecting a different model, the coordinator can call `subagent_list` with `includeModels: true` to retrieve exact currently available identifiers and see agent model pins. It may then set optional call-wide defaults or per-task selections when a bounded slice has a clear cost, latency, or complexity reason:

```text
subagent({
  tasks: [
    { agent: "scout", task: "Locate the relevant files.", model: "provider/model-id", thinking: "low" },
    { agent: "reviewer", task: "Review the narrowed change.", thinking: "high" }
  ],
  agentScope: "both"
})
```

Model selections must be exact available `provider/model` identifiers. Agent frontmatter `model` declarations remain hard pins and take precedence over coordinator selections. Thinking uses Pi's `off | minimal | low | medium | high | xhigh` levels and may still be clamped by Pi to the selected model's capabilities.

## Optional agent frontmatter

Supported optional frontmatter fields include `class`, `output_format`, `required_sections`, and `strictness`. See `EXPLAINER.md` and `skills/using-subagents/SKILL.md` for details.

## Testing

```bash
npm test
```

## License

MIT. See `LICENSE`.
