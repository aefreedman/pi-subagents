import type { AgentExecutionRuntimeRegistrationOptions } from "./workflow-runtime.js";

type WorkflowRuntimeRegistration = Readonly<{ unregister: () => boolean }>;
type WorkflowRuntimeModule = {
	registerSubagentExecutionRuntimeV1(
		scope: object,
		options: AgentExecutionRuntimeRegistrationOptions,
	): WorkflowRuntimeRegistration;
};

type WorkflowRuntimeImporter = () => Promise<WorkflowRuntimeModule>;

function importWorkflowRuntime(): Promise<WorkflowRuntimeModule> {
	return import("./workflow-runtime.js");
}

/** Only a missing optional workflow package is non-fatal; broken installed modules must surface. */
export function isMissingWorkflowContract(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const candidate = error as { code?: unknown; message?: unknown };
	if (candidate.code !== "ERR_MODULE_NOT_FOUND" && candidate.code !== "MODULE_NOT_FOUND") return false;
	if (typeof candidate.message !== "string") return false;
	return /Cannot find (?:package|module) ['"]@aefree\/pi-workflow['"]/.test(candidate.message);
}

export async function registerOptionalSubagentExecutionRuntimeV1(
	scope: object,
	options: AgentExecutionRuntimeRegistrationOptions,
	importer: WorkflowRuntimeImporter = importWorkflowRuntime,
): Promise<WorkflowRuntimeRegistration | undefined> {
	try {
		return (await importer()).registerSubagentExecutionRuntimeV1(scope, options);
	} catch (error) {
		if (isMissingWorkflowContract(error)) return undefined;
		throw error;
	}
}
