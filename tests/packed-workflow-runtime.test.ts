import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
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
      assert.equal(manifest.dependencies["@aefree/pi-workflow"], "^0.1.0");
      assert.equal(manifest.bundledDependencies, undefined);
      assert.equal(JSON.stringify(manifest).includes("file:../"), false);
    }

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
