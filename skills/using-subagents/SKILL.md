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

Subagents may use only the enabled OpenAI Codex GPT-5.6 variants. Unpinned agents inherit the parent model and thinking level when the parent is using one of those variants. Keep that default unless a bounded slice has a clear reason to use a different GPT-5.6 variant.

The root may set call-wide defaults or per-item `model` and `thinking` selections. Before choosing a non-parent model, call `subagent_list` with `includeModels: true`; use one of the exact GPT-5.6 `provider/model` identifiers it returns. Pi thinking levels are `off | minimal | low | medium | high | xhigh`.

Agent frontmatter model pins are policy boundaries and take precedence, but pins outside the enabled GPT-5.6 catalog cannot execute. Do not try to override pins.

### Selection procedure

Choose the model and thinking level separately:

1. Honor any agent model pin.
2. If inheritance is valid and suitable, inherit. Do not override merely to make the task look optimized.
3. Otherwise, choose the least expensive model tier that fits the slice's ambiguity, consequence, and required judgment.
4. Choose the lowest thinking level likely to complete the slice reliably.
5. If a run fails for capability rather than missing context or poor task shaping, retry by increasing one dimension at a time. Improve the task prompt before spending more model effort when the scope or success criteria were unclear.

### Choose a GPT-5.6 variant

- **Luna** (`gpt-5.6-luna`): efficient, high-volume work with explicit instructions and easy verification. Prefer it for bounded reconnaissance, file or history searches, extraction, classification, formatting, check-only validation, and repetitive mechanical edits. Avoid it for ambiguous design choices or consequential review.
- **Terra** (`gpt-5.6-terra`): the default balance of capability and cost. Prefer it for ordinary implementation, focused debugging, flow analysis, planning, test writing, documentation, and routine code review when Luna would leave meaningful judgment to chance.
- **Sol** (`gpt-5.6-sol`): frontier capability for complex professional work. Prefer it when the result depends on resolving ambiguity across systems, making architectural tradeoffs, finding subtle defects, or handling security, data integrity, migrations, concurrency, or other high-consequence concerns.

Task volume alone favors Luna; task complexity and consequence favor Terra or Sol. A small but dangerous change can warrant Sol, while a large batch of independent, mechanical checks can still warrant Luna.

### Choose a Pi thinking level

- `off`: only for direct, non-reasoning transformations where the expected output is effectively specified by the input. Do not use it for investigation, tool-driven work, or implementation.
- `minimal`: extraction, routing, formatting, and other nearly mechanical tasks with an immediate correctness check.
- `low`: bounded discovery, repository or history searches, simple validation, and small well-specified edits.
- `medium`: the default for ordinary implementation, debugging, analysis, and tool-using work.
- `high`: multi-file reasoning, non-obvious debugging, planning with tradeoffs, or reviews where omissions matter.
- `xhigh`: rare, quality-first work with genuine ambiguity or high consequence, such as difficult architecture, security, data-integrity, or risky migration decisions.

Pi may clamp a requested thinking level to the selected model's capabilities. Do not maximize thinking by default: higher levels increase latency and usage and should buy a plausible quality improvement for this specific slice.

### Recommended combinations

- `Luna + minimal/low`: repetitive extraction, routing, search, and mechanical verification.
- `Luna + medium`: bounded implementation only when the task is explicit and strongly testable.
- `Terra + medium`: general default for delegated execution.
- `Terra + high`: complex implementation, debugging, planning, or review that needs sustained judgment.
- `Sol + high`: ambiguous, cross-system, or consequential professional work.
- `Sol + xhigh`: exceptional quality-first work where failure is costly and extra deliberation is justified.

If Luna appears to need `high` or `xhigh` because the task itself is complex, prefer evaluating Terra or Sol instead. Reserve `xhigh` for hard tasks, not vague prompts; first narrow the scope and state the evidence, constraints, output shape, and stop condition.

When selecting a non-inherited combination, record a brief task-specific reason. Base recurring defaults on observed task success, latency, and usage rather than model labels alone. OpenAI's current GPT-5.6 guidance likewise recommends starting from a balanced effort and increasing it only where representative evaluations show a gain: https://developers.openai.com/api/docs/guides/latest-model

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
