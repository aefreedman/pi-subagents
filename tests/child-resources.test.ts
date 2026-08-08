import { strict as assert } from "node:assert";
import { buildChildBaseArgs } from "../src/child-invocation.ts";

const args = buildChildBaseArgs(["/trusted/project/extensions/guard.ts"]);

assert.deepEqual(args, [
	"--mode",
	"json",
	"-p",
	"--no-session",
	"-e",
	"/trusted/project/extensions/guard.ts",
]);
assert(!args.includes("--no-skills"), "delegated children must retain Pi's normal skill discovery");
assert(!args.includes("--no-extensions"), "delegated children must retain Pi's normal extension discovery");

console.log("pi-subagents child resource discovery tests passed");
