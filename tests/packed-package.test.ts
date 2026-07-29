import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "..");
const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

function npm(args: string[], cwd: string): string {
	return execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function mockPackage(root: string, name: string, source: string): Promise<void> {
	const directory = path.join(root, "node_modules", ...name.split("/"));
	await mkdir(directory, { recursive: true });
	await writeFile(path.join(directory, "package.json"), JSON.stringify({ name, type: "module", exports: "./index.js" }));
	await writeFile(path.join(directory, "index.js"), source);
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pi-subagents-packed-package-"));
try {
	const archives = path.join(temporaryRoot, "archives");
	await mkdir(archives);
	const tarballs = ["pi-capability-registry", "pi-subagents"].map((directory) => {
		const packed = JSON.parse(npm(["pack", "--json", "--ignore-scripts", "--pack-destination", archives], path.join(workspaceRoot, directory))) as Array<{ filename: string; bundled?: string[] }>;
		assert.equal(packed.length, 1);
		assert.equal((packed[0]!.bundled ?? []).length, 0);
		return path.join(archives, packed[0]!.filename);
	});

	const installed = path.join(temporaryRoot, "installed");
	await mkdir(installed);
	await writeFile(path.join(installed, "package.json"), JSON.stringify({ name: "packed-subagents-test", private: true, version: "0.0.0" }));
	npm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=optional", ...tarballs], installed);
	await Promise.all([
		mockPackage(installed, "@earendil-works/pi-ai", "export const StringEnum = (_values, options) => options;"),
		mockPackage(installed, "@earendil-works/pi-coding-agent", "export const getMarkdownTheme = () => ({}); export const withFileMutationQueue = async (_path, fn) => await fn();"),
		mockPackage(installed, "@earendil-works/pi-tui", "export class Container { addChild() {} } export class Markdown { constructor() {} } export class Spacer { constructor() {} } export class Text { constructor() {} }"),
		mockPackage(installed, "typebox", "const make = () => ({}); export const Type = { Optional: make, String: make, Array: make, Object: make, Boolean: make }"),
	]);

	const subagentRoot = path.join(installed, "node_modules", "@aefree", "pi-subagents");
	const manifest = JSON.parse(await readFile(path.join(subagentRoot, "package.json"), "utf8"));
	assert.equal(JSON.stringify(manifest).includes("pi-workflow"), false, "packed package must not advertise the retired workflow bridge");
	const extension = await import(pathToFileURL(path.join(subagentRoot, "extensions", "index.ts")).href);
	const registry = await import(pathToFileURL(path.join(subagentRoot, "registry.ts")).href);
	const handlers = new Map<string, Function>();
	const tools: string[] = [];
	const sessionManager = {};
	extension.default({
		on: (name: string, handler: Function) => handlers.set(name, handler),
		registerTool: ({ name }: { name: string }) => tools.push(name),
		getThinkingLevel: () => undefined,
	});
	await handlers.get("session_start")!({}, { sessionManager });
	assert.deepEqual(tools.sort(), ["subagent", "subagent_list"]);
	assert.equal(registry.getRegisteredPackageAgentDirs(sessionManager).length, 1, "session start registers bundled agents");
	await handlers.get("session_shutdown")!({}, {});
	assert.equal(registry.getRegisteredPackageAgentDirs(sessionManager).length, 0, "session shutdown removes bundled-agent registration");
	registry.clearRegisteredPackageAgentDirsForTests();
	console.log("pi-subagents packed standalone package tests passed");
} finally {
	await rm(temporaryRoot, { recursive: true, force: true });
}
