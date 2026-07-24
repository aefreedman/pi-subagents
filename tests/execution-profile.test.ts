import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
	filterAvailableSubagentModels,
	findUnavailableModelSelections,
	resolveAgentExecutionProfile,
} from "../execution-profile.ts";

const inherited = resolveAgentExecutionProfile({
	parentModel: "provider/parent",
	parentThinking: "high",
});
assert.deepEqual(inherited, {
	model: "provider/parent",
	modelSource: "parent",
	thinking: "high",
	thinkingSource: "parent",
});

const callSelected = resolveAgentExecutionProfile({
	parentModel: "provider/parent",
	parentThinking: "high",
	callSelection: { model: "provider/call", thinking: "medium" },
});
assert.deepEqual(callSelected, {
	model: "provider/call",
	modelSource: "call",
	thinking: "medium",
	thinkingSource: "call",
});

const taskSelected = resolveAgentExecutionProfile({
	parentModel: "provider/parent",
	parentThinking: "high",
	callSelection: { model: "provider/call", thinking: "medium" },
	taskSelection: { model: "provider/task", thinking: "low" },
});
assert.deepEqual(taskSelected, {
	model: "provider/task",
	modelSource: "task",
	thinking: "low",
	thinkingSource: "task",
});

const pinnedModel = resolveAgentExecutionProfile({
	agentModel: "provider/pinned",
	parentModel: "provider/parent",
	parentThinking: "medium",
	callSelection: { model: "provider/call", thinking: "low" },
	taskSelection: { model: "provider/task", thinking: "xhigh" },
});
assert.deepEqual(pinnedModel, {
	model: "provider/pinned",
	modelSource: "agent-pin",
	thinking: "xhigh",
	thinkingSource: "task",
});

assert.deepEqual(
	findUnavailableModelSelections(
		["provider/available", "provider/missing", "provider/missing"],
		["provider/available", "provider/other"],
	),
	["provider/missing"],
);

assert.deepEqual(
	filterAvailableSubagentModels([
		"anthropic/claude-sonnet",
		"openai-codex/gpt-5.6-terra",
		"openai-codex/gpt-5.6-luna",
		"openai/gpt-5.6-sol",
		"openai-codex/gpt-5.6-sol",
	]),
	[
		"openai-codex/gpt-5.6-luna",
		"openai-codex/gpt-5.6-sol",
		"openai-codex/gpt-5.6-terra",
	],
);

const extensionSource = readFileSync(new URL("../extensions/index.ts", import.meta.url), "utf8");
assert(extensionSource.includes('args.push("--thinking", executionProfile.thinking)'), "Expected child Pi thinking selection.");
assert(extensionSource.includes("ctx.modelRegistry.getAvailable()"), "Expected coordinator model selections to be availability-checked.");
assert(extensionSource.includes("filterAvailableSubagentModels"), "Expected subagent models to use the GPT-5.6 allowlist.");
assert(extensionSource.includes("includeModels"), "Expected opt-in available-model discovery for coordinators.");

console.log("pi-subagents execution profile tests passed");
