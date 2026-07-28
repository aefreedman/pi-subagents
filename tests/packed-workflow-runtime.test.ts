import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "..");
const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const registryKey = "@aefree/pi-workflow/agent-execution-runtimes/v1";

function npm(args: string[], cwd: string): string {
  return execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function mockPackage(root: string, name: string, source: string): Promise<void> {
  const directory = path.join(root, "node_modules", ...name.split("/"));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ name, type: "module", exports: "./index.js" }));
  await writeFile(path.join(directory, "index.js"), source);
}

try {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pi-subagents-packed-runtime-"));
  try {
    const archives = path.join(temporaryRoot, "archives");
    await mkdir(archives);
    const tarballs: string[] = [];
    for (const directory of ["pi-capability-registry", "pi-workflow", "pi-subagents"]) {
      const packed = JSON.parse(npm(["pack", "--json", "--ignore-scripts", "--pack-destination", archives], path.join(workspaceRoot, directory))) as Array<{ filename: string; files: Array<{ path: string }>; bundled?: string[] }>;
      assert.equal(packed.length, 1);
      assert.equal(packed[0]!.files.some((entry) => entry.path.startsWith("../") || path.isAbsolute(entry.path)), false);
      assert.equal((packed[0]!.bundled ?? []).length, 0);
      tarballs.push(path.join(archives, packed[0]!.filename));
    }

    const copies = ["copy-a", "copy-b"].map((name) => path.join(temporaryRoot, name));
    for (const copy of copies) {
      await mkdir(copy);
      await writeFile(path.join(copy, "package.json"), `${JSON.stringify({ name: path.basename(copy), private: true, version: "0.0.0" }, null, 2)}\n`);
      npm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=optional", ...tarballs], copy);
      const manifest = JSON.parse(await readFile(path.join(copy, "node_modules", "@aefree", "pi-subagents", "package.json"), "utf8"));
      assert.equal(manifest.dependencies["@aefree/pi-workflow"], undefined);
      assert.equal(manifest.peerDependencies["@aefree/pi-workflow"], "^0.1.0");
      assert.equal(manifest.peerDependenciesMeta["@aefree/pi-workflow"].optional, true);
      assert.equal(manifest.bundledDependencies, undefined);
      assert.equal(JSON.stringify(manifest).includes("file:../"), false);
    }

    // A packed core-only install must retain the optional loader without installing workflow.
    const isolated = path.join(temporaryRoot, "without-workflow");
    await mkdir(isolated);
    await writeFile(path.join(isolated, "package.json"), `${JSON.stringify({ name: "without-workflow", private: true, version: "0.0.0" }, null, 2)}\n`);
    npm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=optional", tarballs[0]!, tarballs[2]!], isolated);
    const isolatedSubagentRoot = path.join(isolated, "node_modules", "@aefree", "pi-subagents");
    assert.equal(existsSync(path.join(isolated, "node_modules", "@aefree", "pi-workflow")), false);
    const optionalRuntime = await import(pathToFileURL(path.join(isolatedSubagentRoot, "optional-workflow-runtime.ts")).href);
    assert.equal(await optionalRuntime.registerOptionalSubagentExecutionRuntimeV1({}, { packageRoot: isolatedSubagentRoot, registeredBy: "packed-absence" }), undefined);

    // Minimal Pi shims prove the packed main extension still loads and registers core tools without workflow.
    await Promise.all([
      mockPackage(isolated, "@earendil-works/pi-ai", "export const StringEnum = (_values, options) => options;"),
      mockPackage(isolated, "@earendil-works/pi-coding-agent", "export const getMarkdownTheme = () => ({}); export const withFileMutationQueue = async (_path, fn) => await fn();"),
      mockPackage(isolated, "@earendil-works/pi-tui", "export class Container { addChild() {} } export class Markdown { constructor() {} } export class Spacer { constructor() {} } export class Text { constructor() {} }"),
      mockPackage(isolated, "typebox", "const make = () => ({}); export const Type = { Optional: make, String: make, Array: make, Object: make, Boolean: make };"),
    ]);
    const extension = await import(pathToFileURL(path.join(isolatedSubagentRoot, "extensions", "index.ts")).href);
    const handlers = new Map<string, Function>();
    const tools: string[] = [];
    extension.default({
      on: (name: string, handler: Function) => handlers.set(name, handler),
      registerTool: ({ name }: { name: string }) => tools.push(name),
      getThinkingLevel: () => undefined,
    });
    await handlers.get("session_start")!({}, { sessionManager: {} });
    assert.deepEqual(tools.sort(), ["subagent", "subagent_list"]);

    const subagentRoot = (copy: string) => path.join(copy, "node_modules", "@aefree", "pi-subagents");
    const workflowRoot = (copy: string) => path.join(copy, "node_modules", "@aefree", "pi-workflow");
    const [runtimeA, runtimeB] = await Promise.all(copies.map((copy) => import(pathToFileURL(path.join(subagentRoot(copy), "workflow-runtime.ts")).href)));
    const contractsB = await import(pathToFileURL(path.join(workflowRoot(copies[1]!), "dist", "contracts", "v1", "index.js")).href);
    const scopeA = {};
    const scopeB = {};
    const common = (root: string) => ({ packageRoot: root, registeredBy: "packed-test", launcher: { command: process.execPath, argsPrefix: [] } });
    const registrationA = runtimeA.registerSubagentExecutionRuntimeV1(scopeA, common(subagentRoot(copies[0]!)));
    const registrationB = runtimeB.registerSubagentExecutionRuntimeV1(scopeB, common(subagentRoot(copies[1]!)));
    assert.equal(contractsB.resolveAgentExecutionRuntimeV1(scopeA).outcome, "available", "separate packed copies must share the session registry protocol");
    assert.equal(contractsB.resolveAgentExecutionRuntimeV1(scopeB).outcome, "available");
    assert.equal(registrationA.runtime.owner.packageRoot, subagentRoot(copies[0]!));
    assert.equal(registrationB.runtime.owner.packageRoot, subagentRoot(copies[1]!));
    registrationA.unregister();
    registrationB.unregister();
  } finally {
    delete (globalThis as Record<PropertyKey, unknown>)[Symbol.for(registryKey)];
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  console.log("pi-subagents packed physical runtime copy tests passed");
} catch (error) {
  delete (globalThis as Record<PropertyKey, unknown>)[Symbol.for(registryKey)];
  throw error;
}
