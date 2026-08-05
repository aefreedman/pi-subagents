import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverAgents } from "../src/agents.ts";
import {
  clearRegisteredPackageAgentDirsForTests,
  createPackageAgentDirRegistryV1,
  getRegisteredPackageAgentDirs,
  registerPackageAgentDir,
} from "../src/registry.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-package-agent-registry-"));
const makePackage = (directory: string, name: string, agentName: string) => {
  const packageRoot = path.join(root, directory);
  const agentDir = path.join(packageRoot, "agents");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name, version: "1.2.3" }));
  fs.writeFileSync(path.join(agentDir, `${agentName}.md`), `---\nname: ${agentName}\ndescription: ${name} agent\n---\nbody\n`);
  return { packageRoot, agentDir };
};

try {
  const packageA = makePackage("a", "@fixture/a", "duplicate-name");
  const packageB = makePackage("b", "@fixture/b", "duplicate-name");
  const disabled = makePackage("disabled", "@fixture/disabled", "disabled-agent");
  const scopeA = {};
  const scopeB = {};
  const first = registerPackageAgentDir(scopeA, { ...packageA, registeredBy: "extensions/a.ts" });
  registerPackageAgentDir(scopeB, { ...packageB, registeredBy: "extensions/b.ts" });

  assert.deepEqual(getRegisteredPackageAgentDirs(scopeA).map((entry) => entry.owner.packageName), ["@fixture/a"]);
  assert.deepEqual(getRegisteredPackageAgentDirs(scopeB).map((entry) => entry.owner.packageName), ["@fixture/b"]);
  assert.equal(getRegisteredPackageAgentDirs(scopeA).some((entry) => entry.owner.packageRoot === disabled.packageRoot), false, "disabled packages never enter a session");
  assert(Object.isFrozen(getRegisteredPackageAgentDirs(scopeA)));
  assert(Object.isFrozen(getRegisteredPackageAgentDirs(scopeA)[0]!));
  assert.equal(getRegisteredPackageAgentDirs(scopeA)[0]!.owner.packageVersion, "1.2.3");

  const replacement = registerPackageAgentDir(scopeA, { ...packageA, registeredBy: "extensions/reloaded.ts" });
  assert.equal(first.unregister(), false, "a stale token cannot erase its replacement");
  assert.equal(first.unregister(), false, "cleanup is idempotent");
  assert.equal(getRegisteredPackageAgentDirs(scopeA).length, 1);

  const registry = createPackageAgentDirRegistryV1();
  registry.register(scopeA, {
    contractVersion: 1,
    id: `package-agents:@fixture/b:${packageB.packageRoot}`,
    kind: "package-agent-directory",
    owner: { packageName: "@fixture/b", packageVersion: "1.2.3", packageRoot: packageB.packageRoot, registeredBy: "extensions/b.ts" },
    agentDir: packageB.agentDir,
  });
  registry.register(scopeA, {
    contractVersion: 1,
    id: "package-agents:@fixture/source-alias:/alias",
    kind: "package-agent-directory",
    owner: { packageName: "@fixture/source-alias", packageVersion: "1.0.0", packageRoot: path.join(root, "alias"), registeredBy: "extensions/alias.ts" },
    agentDir: packageA.agentDir,
  });
  const settings = path.join(root, "settings.json");
  fs.writeFileSync(settings, JSON.stringify({ packages: [packageA.packageRoot, packageB.packageRoot, path.join(root, "alias")] }));
  const discovery = discoverAgents(root, "user", { agentDir: path.join(root, "home"), globalSettingsPath: settings, sessionScope: scopeA });
  assert(discovery.warnings.some((warning) => warning.code === "duplicate-agent-name"));
  assert(discovery.warnings.some((warning) => warning.code === "duplicate-agent-source"));
  assert.equal(discovery.agents.some((agent) => agent.name === "disabled-agent"), false);

  assert.equal(replacement.unregister(), true);
  assert.equal(replacement.unregister(), false);
  assert.equal(getRegisteredPackageAgentDirs(scopeB).length, 1, "another SDK loader/session is unaffected");
  console.log("pi-subagents package agent registry tests passed");
} finally {
  clearRegisteredPackageAgentDirsForTests();
  fs.rmSync(root, { recursive: true, force: true });
}
