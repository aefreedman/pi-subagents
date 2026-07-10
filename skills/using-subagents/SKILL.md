---
name: using-subagents
description: "Use `subagent` and `subagent_list` effectively from the root/orchestrator session: choose suitable specialists, shape bounded delegated tasks, and split work into clean single, parallel, or chain slices."
---
# using-subagents

Purpose: root/orchestrator guidance for effective delegated workflows with `pi-subagents`.

## Core rules

- Only the root/orchestrator session should call `subagent` or `subagent_list`.
- Delegated workers must return handoffs instead of spawning more subagents.
- Nested delegation is blocked at runtime, so do not plan workflows that rely on recursive spawning.

## Project-agent trust

Project agents are repository-controlled prompts. The runtime automatically honors Pi project trust:

- trusted projects run without an extra package prompt
- otherwise, interactive approval/denial is requested at most once per canonical project root and Pi session
- untrusted non-interactive execution is denied; use saved Pi trust or an explicit Pi `--approve` launch

Leave `confirmProjectAgents` unset or `true` to permit that interactive fallback. Setting it to `false` denies untrusted project agents; it does not authorize them. Do not repeatedly ask the user to approve agents after the runtime has returned a session-approved trust result.

## Choosing an agent

### Prefer the most specific suitable specialist

Choose the agent whose description most closely matches the actual delegated job.

Prefer dedicated specialists for work like:
- security review
- architecture review
- performance review
- workflow-specific or domain-specific tasks
- repository- or tracker-specific operations

### Use bundled fallback agents when no specialist is a better match

The package may provide bundled fallback roles such as `scout` and `general`, but other installed packages may add better fits for a given task.

Use `scout` for bounded reconnaissance such as:
- locating relevant files, prompts, skills, or configuration
- shortlisting likely source-of-truth files
- narrowing a broad topic into the next slice
- returning early with a compact routing handoff

Use `general` for bounded arbitrary work such as:
- narrow execution tasks with no better dedicated specialist
- extra parallel capacity without authoring a custom agent
- concrete follow-up after reconnaissance narrows the slice

Do not treat `scout` and `general` as the default answer for every delegation.

## Task shaping

Every delegated task should be as bounded as possible.

Prefer task prompts that specify:
- exact goal
- path or topic scope
- expected output shape
- stop condition
- limits on breadth when useful

Good delegation patterns:
- one focused question per subagent
- path-constrained searches
- parallel slices that the parent will synthesize
- scout first, then general/specialist follow-up

Avoid:
- asking one subagent to understand an entire large subsystem
- sending huge pasted context when a few file paths would do
- broad discovery plus implementation in the same delegated task

## Suggested orchestration patterns

### Single focused delegation

Use a single subagent when one bounded task is clearly defined.

### Parallel slices

Use parallel delegation when work can be split cleanly by:
- directory
- concern
- specialist role
- research vs implementation follow-up

The parent should synthesize the results.

### Chain delegation

Use chain mode only when each step genuinely depends on the previous output.

Keep chains short and ensure each step remains bounded.

## Model and thinking selection

Unpinned agents inherit the parent model and thinking level. Keep that default unless a bounded slice has a clear cost, latency, or complexity reason to differ.

The root may set call-wide defaults or per-item `model` and `thinking` selections. Before choosing a non-parent model, call `subagent_list` with `includeModels: true`; use one of its exact available `provider/model` identifiers. Pi thinking levels are `off | minimal | low | medium | high | xhigh`.

Agent frontmatter model pins are policy boundaries and take precedence. Do not try to override them.

Reasonable task-sensitive guidance:
- low or medium: bounded discovery, repository/history searches, and check-only linting
- medium or high: focused planning, flow analysis, and ordinary implementation
- high or xhigh: genuinely ambiguous architecture, security, data-integrity, or risky resolution work

Do not choose solely from the agent's class or maximize thinking by default. Record why a non-inherited selection is worthwhile, and expect Pi to clamp thinking to model capabilities.

## Practical heuristics

- If the task is mostly discovery, start with `scout`.
- If the task is mostly doing, start with `general` or a dedicated specialist.
- If a delegated task starts to sprawl, split it instead of broadening it.
- If you are unsure which specialist to use, call `subagent_list` first.

## Expected outcomes

A good subagent run should return:
- a bounded result
- clear evidence or changed files
- a concise handoff the parent can act on
- recommended next slices when more work is needed
