import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { childExtensionCliArgs, findNearestProjectSettings, resolveChildExtensions } from "../src/child-extensions.ts";

const container = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-child-extensions-"));
try {
	const projectRoot = path.join(container, "project");
	const settingsDir = path.join(projectRoot, ".pi");
	const nestedCwd = path.join(projectRoot, "packages", "child");
	const extensionDir = path.join(projectRoot, "extensions");
	const extensionPath = path.join(extensionDir, "guard.ts");
	fs.mkdirSync(settingsDir, { recursive: true });
	fs.mkdirSync(nestedCwd, { recursive: true });
	fs.mkdirSync(extensionDir, { recursive: true });
	fs.writeFileSync(extensionPath, "export default function () {}\n");

	const settingsPath = path.join(settingsDir, "settings.json");
	fs.writeFileSync(settingsPath, JSON.stringify({
		piSubagents: {
			childExtensions: ["../extensions/guard.ts", "../extensions/guard.ts"],
		},
	}));

	assert.equal(path.normalize(findNearestProjectSettings(nestedCwd)!), path.normalize(settingsPath));
	const resolved = resolveChildExtensions(nestedCwd);
	assert.equal(path.normalize(resolved.projectRoot!), path.normalize(fs.realpathSync.native(projectRoot)));
	assert.deepEqual(resolved.extensions.map((entry) => path.normalize(entry)), [path.normalize(fs.realpathSync.native(extensionPath))]);
	assert.deepEqual(childExtensionCliArgs(resolved.extensions), ["-e", fs.realpathSync.native(extensionPath)]);

	fs.writeFileSync(settingsPath, JSON.stringify({ piSubagents: { childExtensions: "../extensions/guard.ts" } }));
	assert.throws(() => resolveChildExtensions(nestedCwd), /must be an array/);

	const outsidePath = path.join(container, "outside.ts");
	fs.writeFileSync(outsidePath, "export default function () {}\n");
	fs.writeFileSync(settingsPath, JSON.stringify({ piSubagents: { childExtensions: ["../../outside.ts"] } }));
	assert.throws(() => resolveChildExtensions(nestedCwd), /outside the trusted project root/);

	fs.writeFileSync(settingsPath, JSON.stringify({ piSubagents: { childExtensions: ["../extensions/missing.ts"] } }));
	assert.throws(() => resolveChildExtensions(nestedCwd), /does not resolve to an existing file/);

	fs.writeFileSync(settingsPath, JSON.stringify({ piSubagents: { childExtensions: ["../extensions/guard.txt"] } }));
	fs.writeFileSync(path.join(extensionDir, "guard.txt"), "not an extension\n");
	assert.throws(() => resolveChildExtensions(nestedCwd), /must resolve to a .ts/);

	fs.writeFileSync(settingsPath, JSON.stringify({ packages: [] }));
	assert.deepEqual(resolveChildExtensions(nestedCwd).extensions, []);

	const extensionSource = fs.readFileSync(new URL("../extensions/index.ts", import.meta.url), "utf8");
	assert.match(extensionSource, /buildChildBaseArgs\(childExtensions\)/, "child Pi arguments must include resolved extension forwarding flags");
	assert.match(extensionSource, /forwardedExtensions\.length > 0 && !ctx\.isProjectTrusted\(\)/, "project-configured child extensions must require Pi project trust");
} finally {
	fs.rmSync(container, { recursive: true, force: true });
}

console.log("child extension forwarding tests passed");
