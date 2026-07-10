import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import type { AgentConfig } from "../agents.ts";
import { ProjectAgentTrustGate } from "../project-agent-trust.ts";

function agent(
	name: string,
	source: "user" | "project",
	sourceDetail: AgentConfig["sourceDetail"],
	options: { packageName?: string; discoveredFrom?: string } = {},
): AgentConfig {
	return {
		name,
		description: `${name} description`,
		systemPrompt: `${name} prompt`,
		source,
		sourceDetail,
		filePath: `/workspace/.pi/agents/${name}.md`,
		packageName: options.packageName,
		discoveredFrom: options.discoveredFrom,
	};
}

const projectAgent = agent("project-reviewer", "project", "project-local");
const userAgent = agent("user-reviewer", "user", "user-local");
const packageAgent = agent("package-reviewer", "project", "project-package", {
	packageName: "review-pack",
	discoveredFrom: "/workspace/.pi/npm/review-pack/agents",
});

{
	const gate = new ProjectAgentTrustGate();
	const decision = await gate.authorize({
		projectRoot: "/workspace",
		isProjectTrusted: false,
		hasUI: false,
		confirmationEnabled: true,
		agents: [userAgent],
	});
	assert.equal(decision.allowed, true);
	assert.equal(decision.reason, "allow-user-only");
}

{
	const gate = new ProjectAgentTrustGate();
	let confirmations = 0;
	const decision = await gate.authorize({
		projectRoot: "/workspace",
		isProjectTrusted: true,
		hasUI: true,
		confirmationEnabled: true,
		agents: [projectAgent],
		confirm: async () => {
			confirmations++;
			return true;
		},
	});
	assert.equal(decision.allowed, true);
	assert.equal(decision.reason, "allow-pi-trusted");
	assert.equal(confirmations, 0);
}

{
	const gate = new ProjectAgentTrustGate();
	let confirmations = 0;
	const request = {
		projectRoot: "/workspace",
		isProjectTrusted: false,
		hasUI: true,
		confirmationEnabled: true,
		agents: [projectAgent],
		confirm: async () => {
			confirmations++;
			return true;
		},
	};
	const first = await gate.authorize(request);
	const second = await gate.authorize(request);
	assert.equal(first.reason, "allow-confirmed");
	assert.equal(second.reason, "allow-session-approved");
	assert.equal(second.cached, true);
	assert.equal(confirmations, 1, "approval should be requested once per project/session");
}

{
	const gate = new ProjectAgentTrustGate();
	let confirmations = 0;
	const request = {
		projectRoot: "/workspace",
		isProjectTrusted: false,
		hasUI: true,
		confirmationEnabled: true,
		agents: [projectAgent],
		confirm: async () => {
			confirmations++;
			return false;
		},
	};
	const first = await gate.authorize(request);
	const second = await gate.authorize(request);
	assert.equal(first.allowed, false);
	assert.equal(first.reason, "deny-confirmed");
	assert.equal(second.reason, "deny-session");
	assert.equal(confirmations, 1, "denial should also be cached for the session");
}

{
	const gate = new ProjectAgentTrustGate();
	const disabled = await gate.authorize({
		projectRoot: "/workspace",
		isProjectTrusted: false,
		hasUI: true,
		confirmationEnabled: false,
		agents: [projectAgent],
		confirm: async () => true,
	});
	assert.equal(disabled.allowed, false);
	assert.equal(disabled.reason, "deny-confirmation-disabled");

	const noninteractive = await gate.authorize({
		projectRoot: "/other-workspace",
		isProjectTrusted: false,
		hasUI: false,
		confirmationEnabled: false,
		agents: [projectAgent],
	});
	assert.equal(noninteractive.allowed, false);
	assert.equal(noninteractive.reason, "deny-noninteractive");
}

{
	const gate = new ProjectAgentTrustGate();
	const missingRoot = await gate.authorize({
		projectRoot: null,
		isProjectTrusted: false,
		hasUI: true,
		confirmationEnabled: true,
		agents: [projectAgent],
		confirm: async () => true,
	});
	assert.equal(missingRoot.allowed, false);
	assert.equal(missingRoot.reason, "deny-missing-project-root");
}

{
	const gate = new ProjectAgentTrustGate();
	const failed = await gate.authorize({
		projectRoot: "/workspace",
		isProjectTrusted: false,
		hasUI: true,
		confirmationEnabled: true,
		agents: [projectAgent],
		confirm: (() => {
			throw new Error("UI unavailable");
		}) as () => Promise<boolean>,
	});
	assert.equal(failed.allowed, false);
	assert.equal(failed.reason, "deny-confirmation-failed");
	assert.match(failed.errorMessage ?? "", /UI unavailable/);
}

{
	const gate = new ProjectAgentTrustGate();
	let confirmations = 0;
	let resolveConfirmation: ((approved: boolean) => void) | undefined;
	const confirmation = new Promise<boolean>((resolve) => {
		resolveConfirmation = resolve;
	});
	const request = {
		projectRoot: "/workspace",
		isProjectTrusted: false,
		hasUI: true,
		confirmationEnabled: true,
		agents: [projectAgent, packageAgent],
		confirm: async () => {
			confirmations++;
			return confirmation;
		},
	};
	const first = gate.authorize(request);
	const second = gate.authorize(request);
	await Promise.resolve();
	assert.equal(confirmations, 1, "concurrent requests should share one confirmation");
	resolveConfirmation?.(true);
	const decisions = await Promise.all([first, second]);
	assert(decisions.every((decision) => decision.allowed));
	assert.equal(decisions[0].agents.find((entry) => entry.name === packageAgent.name)?.packageName, "review-pack");
	assert.equal(
		decisions[0].agents.find((entry) => entry.name === packageAgent.name)?.sourcePath,
		"/workspace/.pi/npm/review-pack/agents",
	);
}

{
	const gate = new ProjectAgentTrustGate();
	let confirmations = 0;
	const confirm = async () => {
		confirmations++;
		return true;
	};
	await gate.authorize({
		projectRoot: "/workspace-a",
		isProjectTrusted: false,
		hasUI: true,
		confirmationEnabled: true,
		agents: [projectAgent],
		confirm,
	});
	await gate.authorize({
		projectRoot: "/workspace-b",
		isProjectTrusted: false,
		hasUI: true,
		confirmationEnabled: true,
		agents: [projectAgent],
		confirm,
	});
	assert.equal(confirmations, 2, "separate project roots need separate session decisions");
}

const extensionSource = readFileSync(new URL("../extensions/index.ts", import.meta.url), "utf8");
assert(extensionSource.includes("ctx.isProjectTrusted()"), "Expected the runtime to consult Pi project trust.");
assert(
	extensionSource.indexOf("projectAgentTrustGate.authorize") < extensionSource.indexOf("if (params.chain && params.chain.length > 0)"),
	"Expected project-agent trust authorization before any execution-mode launch path.",
);

console.log("pi-subagents project-agent trust tests passed");
