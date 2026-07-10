import type { AgentConfig } from "./agents.js";

export type ProjectAgentTrustReason =
	| "allow-user-only"
	| "allow-pi-trusted"
	| "allow-session-approved"
	| "allow-confirmed"
	| "deny-session"
	| "deny-confirmed"
	| "deny-noninteractive"
	| "deny-confirmation-disabled"
	| "deny-missing-project-root"
	| "deny-confirmation-failed";

export interface ProjectAgentTrustSummary {
	name: string;
	sourceDetail: AgentConfig["sourceDetail"];
	packageName?: string;
	sourcePath: string;
}

export interface ProjectAgentTrustResult {
	allowed: boolean;
	reason: ProjectAgentTrustReason;
	projectRoot: string | null;
	piTrusted: boolean;
	prompted: boolean;
	cached: boolean;
	agents: ProjectAgentTrustSummary[];
	errorMessage?: string;
}

export interface ProjectAgentTrustRequest {
	projectRoot: string | null;
	isProjectTrusted: boolean;
	hasUI: boolean;
	confirmationEnabled: boolean;
	agents: AgentConfig[];
	confirm?: (agents: ProjectAgentTrustSummary[], projectRoot: string) => Promise<boolean>;
}

export function summarizeProjectAgents(agents: AgentConfig[]): ProjectAgentTrustSummary[] {
	return agents
		.filter((agent) => agent.source === "project")
		.map((agent) => ({
			name: agent.name,
			sourceDetail: agent.sourceDetail,
			packageName: agent.packageName,
			sourcePath: agent.discoveredFrom ?? agent.filePath,
		}));
}

function result(
	request: Pick<ProjectAgentTrustRequest, "projectRoot" | "isProjectTrusted">,
	agents: ProjectAgentTrustSummary[],
	allowed: boolean,
	reason: ProjectAgentTrustReason,
	options: { prompted?: boolean; cached?: boolean; errorMessage?: string } = {},
): ProjectAgentTrustResult {
	return {
		allowed,
		reason,
		projectRoot: request.projectRoot,
		piTrusted: request.isProjectTrusted,
		prompted: options.prompted ?? false,
		cached: options.cached ?? false,
		agents,
		errorMessage: options.errorMessage,
	};
}

/**
 * Session-scoped trust gate for repository-controlled agent definitions.
 *
 * Pi trust wins. For project-agent conventions not covered by Pi's resource
 * detection, one interactive decision is cached per canonical project root.
 */
export class ProjectAgentTrustGate {
	private readonly decisions = new Map<string, boolean>();
	private readonly pending = new Map<string, Promise<boolean>>();

	async authorize(request: ProjectAgentTrustRequest): Promise<ProjectAgentTrustResult> {
		const agents = summarizeProjectAgents(request.agents);
		if (agents.length === 0) {
			return result(request, agents, true, "allow-user-only");
		}
		if (request.isProjectTrusted) {
			return result(request, agents, true, "allow-pi-trusted");
		}
		if (!request.projectRoot) {
			return result(request, agents, false, "deny-missing-project-root", {
				errorMessage: "Project-scoped agents were discovered without a canonical project root.",
			});
		}

		const cachedDecision = this.decisions.get(request.projectRoot);
		if (cachedDecision !== undefined) {
			return result(
				request,
				agents,
				cachedDecision,
				cachedDecision ? "allow-session-approved" : "deny-session",
				{ cached: true },
			);
		}

		if (!request.hasUI || !request.confirm) {
			return result(request, agents, false, "deny-noninteractive", {
				errorMessage: "The project is not trusted and interactive confirmation is unavailable.",
			});
		}
		if (!request.confirmationEnabled) {
			return result(request, agents, false, "deny-confirmation-disabled", {
				errorMessage: "The project is not trusted and interactive fallback confirmation is disabled.",
			});
		}

		let confirmation = this.pending.get(request.projectRoot);
		if (!confirmation) {
			confirmation = Promise.resolve().then(() => request.confirm!(agents, request.projectRoot!));
			this.pending.set(request.projectRoot, confirmation);
		}

		try {
			const approved = await confirmation;
			this.decisions.set(request.projectRoot, approved);
			return result(request, agents, approved, approved ? "allow-confirmed" : "deny-confirmed", {
				prompted: true,
				cached: true,
			});
		} catch (error) {
			return result(request, agents, false, "deny-confirmation-failed", {
				prompted: true,
				errorMessage: `Project-agent confirmation failed: ${error instanceof Error ? error.message : String(error)}`,
			});
		} finally {
			if (this.pending.get(request.projectRoot) === confirmation) {
				this.pending.delete(request.projectRoot);
			}
		}
	}
}
