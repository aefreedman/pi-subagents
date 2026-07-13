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

## Project-agent trust

Project agents are repository-controlled prompts. `pi-subagents` uses Pi's existing project-trust state before running them:

- trusted project: run without an extra package prompt
- untrusted interactive project: ask once per canonical project root and cache approval or denial for the Pi session
- untrusted non-interactive project: deny; use saved Pi trust or launch Pi with `--approve`
- user-scoped agent: no project-agent gate

`confirmProjectAgents` now controls whether the one-time interactive fallback is available. Setting it to `false` denies untrusted project-agent execution rather than bypassing trust. This policy is an input-loading guard, not a sandbox or a change to agent tool permissions.

Because `.pi/agents/` and `.pi/subagents.json` are package conventions rather than Pi core trust-triggering resources, the package fallback remains necessary when Pi has no trust decision.

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

Subagent execution is restricted to the available OpenAI Codex GPT-5.6 variants: `gpt-5.6-luna`, `gpt-5.6-sol`, and `gpt-5.6-terra`. Unpinned agents inherit the parent session's provider/model and Pi thinking level when the parent uses one of those variants. The coordinator can call `subagent_list` with `includeModels: true` to retrieve the exact enabled identifiers that are currently available and see agent model pins. It may then set optional call-wide defaults or per-task selections:

```text
subagent({
  tasks: [
    { agent: "scout", task: "Locate the relevant files.", model: "openai-codex/gpt-5.6-luna", thinking: "low" },
    { agent: "reviewer", task: "Review the narrowed change.", model: "openai-codex/gpt-5.6-terra", thinking: "high" }
  ],
  agentScope: "both"
})
```

Model selections and agent frontmatter pins must resolve to an enabled, currently available GPT-5.6 `provider/model` identifier. Agent frontmatter `model` declarations remain hard pins and take precedence over coordinator selections. Thinking uses Pi's `off | minimal | low | medium | high | xhigh` levels and may still be clamped by Pi to the selected model's capabilities.

## Optional agent frontmatter

Supported optional frontmatter fields include `class`, `output_format`, `required_sections`, and `strictness`. See `EXPLAINER.md` and `skills/using-subagents/SKILL.md` for details.

## Testing

```bash
npm test
```

## License

MIT. See `LICENSE`.
