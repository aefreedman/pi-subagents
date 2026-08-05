import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { findVerifiedPiCliLauncher, piInvocation } from "../src/pi-launcher.ts";

assert.equal(findVerifiedPiCliLauncher([process.execPath, fileURLToPath(import.meta.url)], process.execPath), undefined, "ordinary Node scripts must not be treated as Pi CLI hosts");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-verified-cli-"));
try {
	const cli = path.join(root, "dist", "cli.js");
	fs.mkdirSync(path.dirname(cli), { recursive: true });
	fs.writeFileSync(cli, "console.log('fixture')\n");
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", bin: { pi: "dist/cli.js" } }));
	const launcher = findVerifiedPiCliLauncher([process.execPath, cli], process.execPath);
	assert.equal(launcher?.source, "verified-pi-cli");
	const invocation = piInvocation(launcher!, ["--mode", "json"]);
	assert.equal(invocation.command, process.execPath);
	assert.equal(path.normalize(invocation.args[0]!).toLowerCase(), path.normalize(fs.realpathSync.native(cli)).toLowerCase());
	assert.deepEqual(invocation.args.slice(1), ["--mode", "json"]);
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}

console.log("pi-subagents launcher verification tests passed");
