import { strict as assert } from "node:assert";
import {
	isMissingWorkflowContract,
	registerOptionalSubagentExecutionRuntimeV1,
} from "../optional-workflow-runtime.ts";

const options = { packageRoot: "/fixture", registeredBy: "fixture" };

assert.equal(isMissingWorkflowContract({ code: "ERR_MODULE_NOT_FOUND", message: "Cannot find package '@aefree/pi-workflow' imported from /fixture/workflow-runtime.ts" }), true);
assert.equal(isMissingWorkflowContract({ code: "MODULE_NOT_FOUND", message: "Cannot find module '@aefree/pi-workflow/contracts/v1'" }), false, "a missing contract inside a present package must remain visible");
assert.equal(isMissingWorkflowContract({ code: "ERR_MODULE_NOT_FOUND", message: "Cannot find module './missing-internal-file' imported from /node_modules/@aefree/pi-workflow/runtime/v1.js" }), false);
assert.equal(isMissingWorkflowContract({ code: "ERR_MODULE_NOT_FOUND", message: "Cannot find package '@aefree/other-package' imported from /fixture" }), false);

const absent = await registerOptionalSubagentExecutionRuntimeV1({}, options, async () => {
	throw Object.assign(new Error("Cannot find package '@aefree/pi-workflow' imported from /fixture/workflow-runtime.ts"), { code: "ERR_MODULE_NOT_FOUND" });
});
assert.equal(absent, undefined, "only an absent workflow package skips runtime registration");

await assert.rejects(
	registerOptionalSubagentExecutionRuntimeV1({}, options, async () => {
		throw Object.assign(new Error("installed workflow dependency is broken"), { code: "ERR_MODULE_NOT_FOUND" });
	}),
	/installed workflow dependency is broken/,
	"a present but broken workflow import must remain visible",
);

const calls: object[] = [];
const registrations: Array<{ active: boolean }> = [];
const importer = async () => ({
	registerSubagentExecutionRuntimeV1(scope: object) {
		calls.push(scope);
		const state = { active: true };
		registrations.push(state);
		return Object.freeze({ unregister: () => {
			if (!state.active) return false;
			state.active = false;
			return true;
		} });
	},
});
const firstScope = {};
const secondScope = {};
const first = await registerOptionalSubagentExecutionRuntimeV1(firstScope, options, importer);
const replacement = await registerOptionalSubagentExecutionRuntimeV1(secondScope, options, importer);
assert.equal(calls[0], firstScope);
assert.equal(calls[1], secondScope);
assert.equal(first?.unregister(), true);
assert.equal(registrations[1]?.active, true, "old-session cleanup must not remove a new session runtime");
assert.equal(replacement?.unregister(), true);

console.log("pi-subagents optional workflow runtime loading tests passed");
