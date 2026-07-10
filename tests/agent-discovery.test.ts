import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAgents, formatAgentDiscoveryWarnings } from "../agents.ts";
import { buildDelegationPacket } from "../prompting.ts";
import { clearRegisteredPackageAgentDirsForTests, registerPackageAgentDir } from "../registry.ts";

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeAgent(dir: string, name: string, description: string): void {
  ensureDir(dir);
  fs.writeFileSync(
    path.join(dir, `${name}.md`),
    `---\nname: ${name}\ndescription: ${description}\n---\nAgent body for ${name}.\n`,
  );
}

function writeAgentDefinition(dir: string, fileName: string, content: string): void {
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, fileName), content);
}

function agentByName(cwd: string, scope: "user" | "project" | "both", agentDir: string, globalSettingsPath: string, name: string) {
  const result = discoverAgents(cwd, scope, { agentDir, globalSettingsPath });
  return result.agents.find((agent) => agent.name === name);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-tools-discovery-"));

try {
  const userPiDir = path.join(tempRoot, "home", ".pi", "agent");
  const globalSettingsPath = path.join(userPiDir, "settings.json");
  const projectRoot = path.join(tempRoot, "workspace");
  const projectPiDir = path.join(projectRoot, ".pi");

  const userAgentsDir = path.join(userPiDir, "agents");
  writeAgent(userAgentsDir, "shared", "user-local shared");
  writeAgent(userAgentsDir, "user-local-only", "user-local unique");
  writeAgentDefinition(
    userAgentsDir,
    "diagnostic-agent.md",
    [
      "---",
      "name: diagnostic-agent",
      "description: remains discoverable despite diagnostic warnings",
      "tools:",
      "  read: true",
      "mode: subagent",
      "reasoningEffort: high",
      "---",
      "Diagnostic agent body.",
      "",
    ].join("\n"),
  );
  writeAgentDefinition(
    userAgentsDir,
    "empty-tools.md",
    "---\nname: empty-tools\ndescription: empty tools declaration\ntools: []\n---\nEmpty tools body.\n",
  );
  writeAgentDefinition(
    userAgentsDir,
    "inline-tools.md",
    "---\nname: inline-tools\ndescription: valid inline tools declaration\ntools: [read, grep]\n---\nInline tools body.\n",
  );

  const userPackageRoot = path.join(tempRoot, "packages", "user-pack");
  writeAgent(path.join(userPackageRoot, "agents"), "shared", "user-package shared");
  writeAgent(path.join(userPackageRoot, "agents"), "user-package-only", "user-package unique");
  writeJson(path.join(userPackageRoot, "package.json"), { name: "user-pack" });
  registerPackageAgentDir({
    agentDir: path.join(userPackageRoot, "agents"),
    packageRoot: userPackageRoot,
    packageName: "user-pack",
    registeredBy: "test",
  });
  const bundledPackageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  registerPackageAgentDir({
    agentDir: path.join(bundledPackageRoot, "agents"),
    packageRoot: bundledPackageRoot,
    packageName: "pi-subagents",
    registeredBy: "test-bundled",
  });
  writeJson(globalSettingsPath, { packages: [userPackageRoot, bundledPackageRoot] });

  const projectPackageRoot = path.join(tempRoot, "packages", "project-pack");
  writeAgent(path.join(projectPackageRoot, "agents"), "shared", "project-package shared");
  writeAgent(path.join(projectPackageRoot, "agents"), "project-package-only", "project-package unique");
  writeJson(path.join(projectPackageRoot, "package.json"), { name: "project-pack" });
  registerPackageAgentDir({
    agentDir: path.join(projectPackageRoot, "agents"),
    packageRoot: projectPackageRoot,
    packageName: "project-pack",
    registeredBy: "test",
  });

  const projectConfigDir = path.join(tempRoot, "project-config-agents");
  writeAgent(projectConfigDir, "shared", "project-config shared");
  writeAgent(projectConfigDir, "project-config-only", "project-config unique");

  writeAgent(path.join(projectPiDir, "agents"), "shared", "project-local shared");
  writeAgent(path.join(projectPiDir, "agents"), "project-local-only", "project-local unique");
  writeJson(path.join(projectPiDir, "subagents.json"), {
    paths: [path.relative(projectPiDir, projectConfigDir)],
  });
  writeJson(path.join(projectPiDir, "settings.json"), {
    packages: [path.relative(projectPiDir, projectPackageRoot)],
  });

  const sharedBoth = agentByName(projectRoot, "both", userPiDir, globalSettingsPath, "shared");
  assert(sharedBoth, "Expected shared agent in both scope");
  assert.equal(sharedBoth.source, "project");
  assert.equal(sharedBoth.sourceDetail, "project-local");

  const userPackageOnly = agentByName(projectRoot, "both", userPiDir, globalSettingsPath, "user-package-only");
  assert(userPackageOnly, "Expected user package agent to be discoverable");
  assert.equal(userPackageOnly.sourceDetail, "user-package");
  assert.equal(userPackageOnly.packageName, "user-pack");

  const projectPackageOnly = agentByName(projectRoot, "both", userPiDir, globalSettingsPath, "project-package-only");
  assert(projectPackageOnly, "Expected project package agent to be discoverable");
  assert.equal(projectPackageOnly.sourceDetail, "project-package");
  assert.equal(projectPackageOnly.packageName, "project-pack");
  assert.equal(
    projectPackageOnly.packageRoot?.replace(/\\/g, "/"),
    fs.realpathSync.native(projectPackageRoot).replace(/\\/g, "/"),
  );

  const projectConfigOnly = agentByName(projectRoot, "both", userPiDir, globalSettingsPath, "project-config-only");
  assert(projectConfigOnly, "Expected project config-path agent to be discoverable");
  assert.equal(projectConfigOnly.sourceDetail, "project-config-path");

  const discoveryWithWarnings = discoverAgents(projectRoot, "both", { agentDir: userPiDir, globalSettingsPath });
  assert.equal(
    discoveryWithWarnings.projectRoot?.replace(/\\/g, "/"),
    fs.realpathSync.native(projectRoot).replace(/\\/g, "/"),
    "Expected discovery to expose one canonical project root for trust caching",
  );
  const nestedProjectCwd = path.join(projectRoot, "src", "nested");
  ensureDir(nestedProjectCwd);
  const nestedDiscovery = discoverAgents(nestedProjectCwd, "both", { agentDir: userPiDir, globalSettingsPath });
  assert.equal(
    nestedDiscovery.projectRoot?.replace(/\\/g, "/"),
    discoveryWithWarnings.projectRoot?.replace(/\\/g, "/"),
    "Nested working directories must share one canonical project trust cache key",
  );
  const diagnosticAgent = discoveryWithWarnings.agents.find((agent) => agent.name === "diagnostic-agent");
  assert(diagnosticAgent, "Diagnostic warnings must not reject an otherwise valid agent");
  assert.equal(diagnosticAgent.tools, undefined, "Malformed tools maps must not become invalid CLI tool names");
  const diagnosticWarnings = discoveryWithWarnings.warnings.filter(
    (warning) => warning.agentName === "diagnostic-agent",
  );
  assert.deepEqual(
    diagnosticWarnings.map((warning) => warning.code).sort(),
    ["malformed-tools-declaration", "unsupported-frontmatter-fields"],
  );
  assert.deepEqual(
    diagnosticWarnings.find((warning) => warning.code === "unsupported-frontmatter-fields")?.fields,
    ["mode", "reasoningEffort"],
  );
  const emptyToolsAgent = discoveryWithWarnings.agents.find((agent) => agent.name === "empty-tools");
  assert(emptyToolsAgent, "Empty tools diagnostics must not reject the agent");
  assert.equal(emptyToolsAgent.tools, undefined);
  assert(
    discoveryWithWarnings.warnings.some(
      (warning) => warning.agentName === "empty-tools" && warning.code === "empty-tools-declaration",
    ),
  );
  const inlineToolsAgent = discoveryWithWarnings.agents.find((agent) => agent.name === "inline-tools");
  assert(inlineToolsAgent, "Expected inline-list agent to be discoverable");
  assert.deepEqual(inlineToolsAgent.tools, ["read", "grep"]);
  assert.equal(
    discoveryWithWarnings.warnings.some((warning) => warning.agentName === "inline-tools"),
    false,
    "Valid inline tools lists should not produce diagnostics",
  );
  const formattedWarnings = formatAgentDiscoveryWarnings(discoveryWithWarnings.warnings, 2);
  assert.match(formattedWarnings.text, /diagnostic-agent|empty-tools/);
  assert(formattedWarnings.remaining >= 1, "Warning formatting should report compact truncation");

  const packageDelegationPacket = buildDelegationPacket({
    agent: projectPackageOnly,
    task: "Read an on-demand package reference.",
    cwd: projectRoot,
    defaultCwd: projectRoot,
    mode: "single",
  });
  assert.match(
    packageDelegationPacket,
    new RegExp(`Agent package root: ${projectPackageOnly.packageRoot?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
  const localDelegationPacket = buildDelegationPacket({
    agent: projectConfigOnly,
    task: "Perform a local task.",
    cwd: projectRoot,
    defaultCwd: projectRoot,
    mode: "single",
  });
  assert.equal(localDelegationPacket.includes("Agent package root:"), false);

  const userScopeShared = agentByName(projectRoot, "user", userPiDir, globalSettingsPath, "shared");
  assert(userScopeShared, "Expected shared agent in user scope");
  assert.equal(userScopeShared.sourceDetail, "user-local");

  const bundledGeneral = agentByName(projectRoot, "user", userPiDir, globalSettingsPath, "general");
  assert(bundledGeneral, "Expected bundled general agent to be discoverable");
  assert.equal(bundledGeneral.sourceDetail, "user-package");
  assert.equal(bundledGeneral.packageName, "pi-subagents");

  const cwdUnderHome = path.join(tempRoot, "home", "scratch", "nested");
  ensureDir(cwdUnderHome);
  const homeNestedScout = agentByName(cwdUnderHome, "user", userPiDir, globalSettingsPath, "user-package-only");
  assert(homeNestedScout, "Expected user package agent under a cwd nested beneath the user home");
  assert.equal(homeNestedScout.sourceDetail, "user-package");

  const projectScopeShared = agentByName(projectRoot, "project", userPiDir, globalSettingsPath, "shared");
  assert(projectScopeShared, "Expected shared agent in project scope");
  assert.equal(projectScopeShared.sourceDetail, "project-local");

  const userScopeProjectPackage = agentByName(projectRoot, "user", userPiDir, globalSettingsPath, "project-package-only");
  assert.equal(userScopeProjectPackage, undefined, "Project package agent should not appear in user scope");

  const projectScopeUserPackage = agentByName(projectRoot, "project", userPiDir, globalSettingsPath, "user-package-only");
  assert.equal(projectScopeUserPackage, undefined, "User package agent should not appear in project scope");

  console.log("pi-subagents agent discovery tests passed");
} finally {
  clearRegisteredPackageAgentDirsForTests();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
