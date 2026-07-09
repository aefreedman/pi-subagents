import type { AgentConfig, AgentOutputFormat } from "./agents.js";

export interface OutputContractValidationResult {
	ok: boolean;
	issues: string[];
}

export interface DelegationPromptInput {
	agent: AgentConfig;
	task: string;
	cwd: string;
	defaultCwd: string;
	step?: number;
	mode: "single" | "parallel" | "chain";
}

const SHARED_DELEGATION_PROMPT = `You are a delegated Pi worker operating on behalf of a parent Pi agent.

Your operating rules:
- Stay tightly scoped to the assigned subtask.
- You are not the top-level orchestrator for this workflow.
- Do not invoke \`subagent\` or \`subagent_list\`.
- Do not spawn additional specialists or ask the system to do so directly.
- Do not broaden the scope unless the task explicitly asks for it.
- Base claims on evidence you actually observed.
- Call out blockers, uncertainty, or missing information clearly instead of guessing.
- Return a handoff that is maximally useful to the parent agent.
- If more work is needed beyond your scope, return a parent handoff using sections named \`Missing Context\`, \`Why It Matters\`, \`Recommended Follow-up\`, \`Suggested Agent\`, and \`Suggested Inputs\` instead of delegating further.
- Keep the final answer focused on the assigned deliverable rather than generic commentary.`;

const CLASS_PROMPTS: Record<string, string> = {
	research: `Research specialists should prioritize fast evidence gathering, cite concrete file paths or sources, and separate confirmed findings from open questions.`,
	review: `Review specialists should focus on issues, risks, supporting evidence, and recommended fixes or follow-up checks.`,
	workflow: `Workflow specialists should focus on the requested operational step, completion status, blockers, and the next action the parent agent should take.`,
	planning: `Planning specialists should identify options, tradeoffs, risks, and a recommended path forward with crisp next steps.`,
	implementation: `Implementation specialists should stay concrete, describe the exact change or approach, and summarize validation plus remaining risks.`,
};

const CLASS_DELIVERABLE_HINTS: Record<string, string[]> = {
	research: ["Findings", "Evidence", "Open Questions", "Recommended Next Step"],
	review: ["Verdict", "Issues", "Evidence", "Recommended Fixes"],
	workflow: ["Result", "Evidence", "Blockers", "Recommended Next Step"],
	planning: ["Goal", "Options", "Recommendation", "Risks", "Next Steps"],
	implementation: ["Plan", "Changes", "Validation", "Remaining Risks"],
};

function summarizeDescription(description: string, maxLength = 220): string {
	const firstParagraph = description.split(/\r?\n\r?\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
	if (firstParagraph.length <= maxLength) return firstParagraph;
	return `${firstParagraph.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatStrictnessLine(agent: AgentConfig): string {
	switch ((agent.strictness ?? "").toLowerCase()) {
		case "high":
			return "Follow the requested deliverable format exactly. If the contract cannot be satisfied, say so clearly.";
		case "low":
			return "Prefer the requested deliverable shape, but keep the answer useful and concise.";
		default:
			return "Follow the requested deliverable shape closely when one is provided.";
	}
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripCodeFence(value: string): string {
	const trimmed = value.trim();
	const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
	return fenced ? fenced[1].trim() : trimmed;
}

function normalizeOutputFormat(format: AgentOutputFormat | undefined): string | undefined {
	return typeof format === "string" && format.trim().length > 0 ? format.trim().toLowerCase() : undefined;
}

function isSectionPresent(output: string, section: string): boolean {
	const escaped = escapeRegex(section.trim());
	const headingPatterns = [
		new RegExp(`^\\s{0,3}#{1,6}\\s*${escaped}\\s*$`, "im"),
		new RegExp(`^\\s{0,3}\\*\\*\\s*${escaped}\\s*\\*\\*\\s*$`, "im"),
		new RegExp(`^\\s{0,3}${escaped}\\s*:\\s*$`, "im"),
		new RegExp(`^\\s{0,3}[-*]\\s+\\*\\*\\s*${escaped}\\s*\\*\\*`, "im"),
	];
	return headingPatterns.some((pattern) => pattern.test(output));
}

export function buildSubagentSystemPrompt(agent: AgentConfig): string {
	const parts = [SHARED_DELEGATION_PROMPT];
	if (agent.agentClass && CLASS_PROMPTS[agent.agentClass]) {
		parts.push(CLASS_PROMPTS[agent.agentClass]);
	}
	parts.push(formatStrictnessLine(agent));
	if (agent.systemPrompt.trim()) {
		parts.push(agent.systemPrompt.trim());
	}
	return parts.join("\n\n").trim();
}

function buildContractLines(agent: AgentConfig): string[] {
	const lines: string[] = [];
	const outputFormat = normalizeOutputFormat(agent.outputFormat);
	if (outputFormat === "json") {
		lines.push("- Return valid JSON in the final answer.");
		lines.push("- Prefer plain JSON without Markdown fences.");
	} else if (outputFormat) {
		lines.push(`- Output format: ${outputFormat}.`);
	}

	if (agent.requiredSections && agent.requiredSections.length > 0) {
		lines.push("Required sections:");
		for (const section of agent.requiredSections) {
			lines.push(`- ${section}`);
		}
		return lines;
	}

	if (agent.agentClass && CLASS_DELIVERABLE_HINTS[agent.agentClass]) {
		lines.push("Recommended handoff shape:");
		for (const section of CLASS_DELIVERABLE_HINTS[agent.agentClass]) {
			lines.push(`- ${section}`);
		}
		return lines;
	}

	lines.push("- Return a concise, evidence-backed handoff the parent agent can act on.");
	lines.push(
		"- If the task cannot be completed within your scope, return a parent handoff with sections: Missing Context, Why It Matters, Recommended Follow-up, Suggested Agent, Suggested Inputs.",
	);
	return lines;
}

export function buildDelegationPacket(input: DelegationPromptInput): string {
	const effectiveCwd = input.cwd ?? input.defaultCwd;
	const summary = summarizeDescription(input.agent.description);
	const contractLines = buildContractLines(input.agent);
	const modeLabel = input.mode === "chain" && input.step ? `chain step ${input.step}` : input.mode;
	const specialistLines = [
		`- Name: ${input.agent.name}`,
		`- Source: ${input.agent.source}`,
		...(input.agent.agentClass ? [`- Class: ${input.agent.agentClass}`] : []),
		...(input.agent.packageRoot ? [`- Agent package root: ${input.agent.packageRoot}`] : []),
		`- Summary: ${summary}`,
	];

	return [
		"# Delegation Packet",
		"",
		"## Specialist",
		...specialistLines,
		"",
		"## Execution Context",
		`- Mode: ${modeLabel}`,
		`- Working directory: ${effectiveCwd}`,
		"",
		"## Response Expectations",
		...contractLines,
		"",
		"## Assigned Task",
		input.task.trim(),
	].join("\n");
}

export function validateOutputContract(agent: AgentConfig, output: string): OutputContractValidationResult {
	const issues: string[] = [];
	const trimmedOutput = output.trim();
	const outputFormat = normalizeOutputFormat(agent.outputFormat);

	if (outputFormat === "json") {
		if (!trimmedOutput) {
			issues.push("Expected valid JSON output, but the agent returned no final text.");
		} else {
			try {
				JSON.parse(stripCodeFence(trimmedOutput));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				issues.push(`Expected valid JSON output, but parsing failed: ${message}`);
			}
		}
	}

	if (agent.requiredSections && agent.requiredSections.length > 0) {
		if (!trimmedOutput) {
			issues.push(`Missing required sections: ${agent.requiredSections.join(", ")}`);
		} else {
			const missing = agent.requiredSections.filter((section) => !isSectionPresent(trimmedOutput, section));
			if (missing.length > 0) {
				issues.push(`Missing required sections: ${missing.join(", ")}`);
			}
		}
	}

	return { ok: issues.length === 0, issues };
}
