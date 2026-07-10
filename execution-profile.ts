export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type ModelSelectionSource = "agent-pin" | "task" | "call" | "parent";
export type ThinkingSelectionSource = "task" | "call" | "parent";

export interface ExecutionSelection {
	model?: string;
	thinking?: ThinkingLevel;
}

export interface AgentExecutionProfile {
	model?: string;
	modelSource?: ModelSelectionSource;
	thinking?: ThinkingLevel;
	thinkingSource?: ThinkingSelectionSource;
}

export function findUnavailableModelSelections(requested: string[], available: string[]): string[] {
	const availableSet = new Set(available);
	return Array.from(new Set(requested)).filter((model) => !availableSet.has(model));
}

/**
 * Resolve one child invocation's model and thinking level.
 *
 * Agent model declarations are hard pins. For unpinned agents, item-level
 * selections override call-wide defaults, which override parent inheritance.
 * Thinking remains task-sensitive and is therefore selected per item/call or
 * inherited from the parent rather than pinned in agent frontmatter.
 */
export function resolveAgentExecutionProfile({
	agentModel,
	parentModel,
	parentThinking,
	callSelection = {},
	taskSelection = {},
}: {
	agentModel?: string;
	parentModel?: string;
	parentThinking?: ThinkingLevel;
	callSelection?: ExecutionSelection;
	taskSelection?: ExecutionSelection;
}): AgentExecutionProfile {
	const model = agentModel ?? taskSelection.model ?? callSelection.model ?? parentModel;
	const modelSource: ModelSelectionSource | undefined = agentModel
		? "agent-pin"
		: taskSelection.model
			? "task"
			: callSelection.model
				? "call"
				: parentModel
					? "parent"
					: undefined;

	const thinking = taskSelection.thinking ?? callSelection.thinking ?? parentThinking;
	const thinkingSource: ThinkingSelectionSource | undefined = taskSelection.thinking
		? "task"
		: callSelection.thinking
			? "call"
			: parentThinking
				? "parent"
				: undefined;

	return { model, modelSource, thinking, thinkingSource };
}
