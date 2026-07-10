# Subagent Tools Explainer

This document explains how this package works internally.

It is intended as the more detailed companion to `README.md`.

## What this package does

`pi-subagents` adds a Pi tool named:
- `subagent`

and a helper discovery tool named:
- `subagent_list`

The package gives Pi a practical, Pi-native delegated specialist workflow.

The core idea is simple:
- each delegated specialist runs in a **fresh child `pi` process**
- the child gets a **specialized prompt stack**
- delegated workers are treated as workers, not orchestrators
- nested delegation is blocked by default at runtime
- the parent session receives the child's final output, tool activity, and usage stats back through Pi JSON mode

This gives us:
- isolated conversation context per specialist
- optional per-agent model selection
- optional per-agent tool restriction
- optional output contracts
- support for single, parallel, and chain orchestration

## High-level architecture

The package currently centers on three files:

- `extensions/index.ts`
  - tool registration
  - orchestration
  - child process spawning
  - result aggregation
  - rendering in the Pi UI
- `agents.ts`
  - agent discovery
  - frontmatter parsing
  - metadata normalization
- `prompting.ts`
  - shared delegation meta-prompt
  - class-aware prompt overlays
  - structured delegation packet construction
  - output contract validation

## Where agents come from

Agents are just Markdown files with frontmatter and a body prompt.

Discovery sources:
- user-global local agent definitions from `~/.pi/agent/agents/`
- user-global package agent directories registered by installed packages
- bundled package agent directories registered by `pi-subagents` itself (including the fallback `general` agent)
- project-local agent definitions discovered relative to the current working directory
- additional project-declared agent directories from `.pi/subagents.json`
- project-local package agent directories registered by project-installed packages

### Discovery scope

The `subagent` tool supports:
- `agentScope: "user"`
- `agentScope: "project"`
- `agentScope: "both"`

Behavior:
- `user`
  - load user-global local agents and user-installed package agents
- `project`
  - load project-local agents, `.pi/subagents.json` agent dirs, and project-installed package agents
- `both`
  - load all supported user-global and project-scoped agents

### Name collision behavior

Discovery precedence is intentionally explicit:
1. project-local `.pi/agents/`
2. project-local `.pi/subagents.json` paths
3. project-installed package agent dirs
4. user-global `~/.pi/agent/agents/`
5. user-installed package agent dirs

The loader applies those sources from lowest priority to highest priority, then stores agents in a map keyed by agent name.
That means higher-priority sources override lower-priority sources when names collide.

That is intentional and useful for project-specific specialization.

### Host-agent usage guidance

Host/orchestrator usage guidance such as choosing `general` vs `scout` and shaping delegated tasks lives in the package skill:
- `skills/using-subagents/SKILL.md`

This explainer stays focused on the package's human-facing architecture and runtime behavior.

## Agent file format

Minimum required frontmatter:

```md
---
name: scout
description: Bounded repository reconnaissance for low-complexity discovery tasks.
---
```

Common optional fields:

```md
---
name: scout
description: Bounded repository reconnaissance for low-complexity discovery tasks.
tools: read, grep, find, ls
model: openai-codex/gpt-5.6-luna
class: research
output_format: markdown_sections
required_sections: Findings, Key Files, Stop Reason, Recommended Next Slice
strictness: high
---
```

### Required fields

- `name`
- `description`

If either is missing, the file is ignored for discovery.

Discovery remains permissive for otherwise valid agents, but records warnings for unsupported top-level fields and for empty or malformed `tools` declarations. `subagent_list` appends a compact warning summary and includes the complete structured warnings in its result details. Malformed tool maps are not forwarded as invalid CLI tool names.

### Optional fields

- `tools`
  - comma-separated string or array
  - if present, passed to child Pi via `--tools`
- `model`
  - if present, passed to child Pi via `--model`
- `class`
  - prompt-shaping hint such as:
    - `research`
    - `review`
    - `workflow`
    - `planning`
    - `implementation`
- `output_format`
  - current notable values:
    - `markdown_sections`
    - `json`
- `required_sections`
  - comma-separated or array form
  - used for final output validation
- `strictness`
  - currently affects shared prompt wording
  - typical values:
    - `low`
    - `medium`
    - `high`

### Package registration contract

Pi itself does not yet have a built-in package manifest slot for `agents/` directories.

The package-level contract used here is therefore:
- keep canonical agent definitions as Markdown files under `agents/`
- ship a tiny extension that registers that directory with the shared `pi-subagents` package-agent registry
- let `pi-subagents` classify the registered package directory as `user-package` or `project-package` based on install context
- `pi-subagents` uses the same contract for its own bundled `agents/` directory, which currently provides the fallback `general` agent

The shared registry lives on `globalThis`, so separate extension packages loaded into the same Pi runtime can cooperate without requiring Pi-native package-agent support.

### Agent body

Everything after the frontmatter is treated as the agent's role-specific prompt body.

It is appended into the child agent's effective system prompt.

## Prompting model

The child agent does **not** get only a loose user prompt.

It receives a layered prompt stack.

### System-prompt layers

The child process still gets Pi's normal prompt/context stack first, including things like:
- Pi default system prompt
- active tools
- project context files loaded by Pi
- active packages/extensions
- current working directory context

Then `pi-subagents` appends:

1. **shared delegation meta-prompt**
   - explains that the child is a delegated Pi worker working for a parent Pi agent
   - forbids `subagent` / `subagent_list` recursion
   - emphasizes scope control, evidence, blockers, escalation handoffs, and handoff quality
2. **optional class overlay**
   - small extra guidance for `research`, `review`, `workflow`, `planning`, or `implementation`
3. **agent-specific prompt body**
   - the Markdown body from the agent file

This means the package currently uses:
- **append** behavior

not full system prompt replacement.

That was chosen deliberately to preserve Pi-native behavior and reduce migration risk.

### User-prompt layer

The actual delegated task is sent as a **structured delegation packet**, not just:

```text
Task: ...
```

The packet currently includes sections like:
- `Specialist`
- `Execution Context`
- `Response Expectations`
- `Assigned Task`

For an agent discovered from a registered package, the specialist metadata also includes the agent package root. This lets the delegated worker locate package-owned references or other on-demand assets without embedding them into every agent prompt.

That structure makes the child prompt more consistent and easier to debug.

## Runtime flow

This is the full lifecycle of a subagent call.

### 1. Parent session calls `subagent`

A parent/root Pi session may call the `subagent` tool in one of three modes:
- single
- parallel
- chain

Current runtime policy:
- delegated workers may not call `subagent` or `subagent_list`
- nested delegation is blocked and surfaced as an error/tool result
- workers are expected to return parent handoffs instead of spawning another worker

### 2. Package discovers candidate agents

`discoverAgents()` loads agents from the configured scope and collects non-fatal frontmatter diagnostics. Unsupported fields and empty or malformed tool declarations remain visible through `subagent_list` instead of silently implying runtime support.

If project agents are requested and UI is available, the package can ask for confirmation before running project-controlled agents.

This is an important trust boundary.

### 3. Package builds child invocation

For each delegated agent, `runSingleAgent()` constructs a child Pi invocation.

Base args:
- `--mode json`
- `-p`
- `--no-session`

Optional args:
- `--model <resolved-model>`
- `--thinking <resolved-thinking-level>`
- `--tools <agent.tools>`
- `--append-system-prompt <temp-file>`

Runtime guard behavior:
- child invocations carry delegation-depth metadata in the environment
- nested `subagent` / `subagent_list` calls are rejected when depth is already greater than zero
- explicit `tools` lists have `subagent` and `subagent_list` stripped before launch

Important implications:
- `--no-session` gives the child a fresh conversation context
- `--mode json` lets the parent parse structured Pi events
- `--append-system-prompt` is how the specialized prompt is injected

### 4. Package writes the composed system prompt to a temp file

The package builds the child system prompt with `buildSubagentSystemPrompt()` and writes it to a temp file.

That temp file is then passed to Pi with:
- `--append-system-prompt`

The temp file is cleaned up after execution.

### 5. Package sends the delegation packet as the child user prompt

The delegated task is wrapped with `buildDelegationPacket()` and passed as the actual child prompt.

This is where the child learns:
- who it is
- what kind of specialist it is
- what output is expected
- what the exact task is

### 6. Parent captures child events through Pi JSON mode

The package reads the child process stdout line-by-line.

It listens for Pi events such as:
- `message_end`
- `tool_result_end`

From those events it collects:
- assistant messages
- tool activity
- usage stats
- stop reason
- model information
- error messages

### 7. Package validates the final output contract

After the child finishes, `validateOutputContract()` checks the child's final assistant text.

Current validation targets:
- `output_format: json`
- `required_sections: ...`

If validation fails:
- the result is marked as a contract failure
- an error message is attached
- the parent `subagent` tool surfaces that failure clearly

### 8. Parent returns aggregated result

Depending on mode, the tool returns:
- one result
- multiple parallel results
- a chained sequence of results

The parent UI renderer can then show:
- final output
- child tool calls
- usage/cost summary
- errors or contract failures

## Execution modes

## Single mode

Shape:

```text
subagent(agent="name", task="...")
```

Behavior:
- launches exactly one child Pi process
- returns its final output or failure

## Parallel mode

Shape:

```text
subagent(tasks=[{ agent, task }, ...])
```

Behavior:
- launches several child agents
- runs them with a concurrency limit
- aggregates results into one tool response

Current package limits:
- max parallel tasks: 8
- max runtime concurrency: 4

## Chain mode

Shape:

```text
subagent(chain=[{ agent, task }, ...])
```

Behavior:
- runs agents one after another
- supports `{previous}` placeholder substitution
- each step can consume the prior step's final output

Important note:
- the current chain model only injects the **previous final text output**
- it does not automatically pass full structured history between steps

That was kept intentionally simple for this slice.

## Output contracts

Output contracts are optional.

If an agent file does not declare them, the package still improves prompting, but it does not enforce additional validation.

## Markdown section contracts

If an agent declares:

```md
output_format: markdown_sections
required_sections: Findings, Evidence
```

then the final output is checked for those sections.

The validator currently accepts several common heading styles, including:
- `## Findings`
- `### Findings`
- `Findings:`
- `**Findings**`

This is intentionally a little flexible, rather than demanding one exact Markdown syntax.

## JSON contracts

If an agent declares:

```md
output_format: json
```

then the final output must parse as JSON.

The validator also tolerates a single fenced JSON block, for example:

```json
{"status":"ok"}
```

although plain JSON is preferred.

## Tool restriction behavior

If an agent declares `tools`, the child Pi process is launched with that reduced tool set.

Additionally:
- `subagent` and `subagent_list` are stripped from explicit child tool allowlists
- nested delegation is still blocked at runtime even if those tools remain otherwise visible in the child environment

That means specialization is not only prompt-level.

The child can be constrained operationally as well.

## Model and thinking selection behavior

If an agent declares `model`, the child Pi process uses that exact model. This is a hard pin and takes precedence over coordinator selections.

For unpinned agents, the coordinator may provide:

- call-wide `model` and `thinking` defaults
- per-item `model` and `thinking` selections in parallel or chain mode

Resolution order is:

- model: agent pin, then per-item selection, then call-wide selection, then parent model
- thinking: per-item selection, then call-wide selection, then parent thinking level

Coordinator model selections must be exact available `provider/model` identifiers. `subagent_list({ includeModels: true })` exposes that catalog and identifies hard agent model pins; the `subagent` tool rejects unavailable selections before launching child processes. Thinking uses Pi's `off`, `minimal`, `low`, `medium`, `high`, and `xhigh` levels and is passed with `--thinking`; Pi may clamp it to the selected model's capabilities.

This makes it possible to mix:
- unpinned agents that track the parent session's model and thinking level
- low-thinking reconnaissance or lint slices
- higher-thinking architecture, security, or ambiguous implementation slices
- trusted agent definitions with hard model pins

The result renderer retains the complete model id, including point version and named subtype, and shows the selected thinking level. Structured result details also retain whether each selection came from the agent pin, task, call, or parent.

## UI / rendering behavior

The package includes custom result rendering in `extensions/index.ts`.

The renderer shows:
- agent name
- whether it came from `user` or `project`
- task preview
- child tool-call previews
- final output rendered as Markdown when expanded
- usage summaries
- error states
- contract failure marker

This is why subagent results are more informative than a plain string dump.

## Security / trust model

Project-local agents are effectively repo-controlled prompts.

That means they are a trust boundary.

Current safeguards:
- the package can prompt for confirmation before using project agents
- the README explicitly warns that project-level agent prompts should only be enabled for trusted repositories

This is especially important when `agentScope` is:
- `project`
- `both`

## Current limitations

This package is a strong foundation, but it is still not full built-in multi-agent orchestration.

Current limitations include:
- no automatic retry/repair loop after contract failure
- no richer machine-validated result schema beyond the current lightweight checks
- no automatic prompt compression or summary handoff between chain steps
- no full custom system prompt replacement mode per agent
- no built-in parent/child structured protocol beyond the delegation packet and final-output validation

So the package is currently best understood as:
- **Pi-native delegated specialists built on isolated child Pi processes**

not:
- a brand-new standalone multi-agent runtime

## Why the design looks like this

The design intentionally favors:
- small migration-safe steps
- Pi-native behavior
- package composition
- compatibility with current project/global Pi config
- stable tool naming

That is why the implementation keeps:
- child `pi` process spawning
- `--append-system-prompt`
- normal Pi package/context loading

rather than immediately trying to replace Pi's orchestration model wholesale.

## Suggested reading order

If you want to understand the code quickly, read in this order:

1. `README.md`
2. `agents.ts`
3. `prompting.ts`
4. `extensions/index.ts`

Then inspect one or two real agent Markdown files in whatever host project or package is using `pi-subagents`.
