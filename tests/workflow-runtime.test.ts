import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createCapabilityRegistry } from "@aefree/pi-capability-registry";
import {
  createAgentExecutionRuntimeRegistryV1,
  resolveAgentExecutionRuntimeV1,
} from "@aefree/pi-workflow/contracts/v1";
import {
  createScopedWorkflowExecutionContextV1,
  registerWorkflowRuntimeServicesV1,
} from "@aefree/pi-workflow/runtime/v1";
import {
  buildDelegatedChildEnv,
  DELEGATION_DEPTH_ENV,
  DELEGATION_PARENT_AGENT_ENV,
  DELEGATION_ROOT_AGENT_ENV,
  getDelegationContext,
} from "../delegation-context.ts";
import {
  createSubagentExecutionRuntimeV1,
  executeUserScopedSubagentsV1,
  registerSubagentExecutionRuntimeV1,
} from "../workflow-runtime.ts";
import { findVerifiedPiCliLauncher } from "../pi-launcher.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const key = "@aefree/pi-workflow/agent-execution-runtimes/v1";

function reset(): void {
  delete (globalThis as Record<PropertyKey, unknown>)[Symbol.for(key)];
  delete (globalThis as Record<PropertyKey, unknown>)[Symbol.for("@aefree/pi-workflow/services/v1")];
  delete (globalThis as Record<PropertyKey, unknown>)[Symbol.for("@aefree/pi-workflow/operation-scoped-vcs-services/v1")];
  delete (globalThis as Record<PropertyKey, unknown>)[Symbol.for("@aefree/pi-subagents/package-agent-directories/v1")];
}

function options(marker = "fixture") {
  return {
    packageRoot,
    registeredBy: marker,
    launcher: { command: process.execPath, argsPrefix: [] },
    execute: async (_context: unknown, request: { mode: "single" | "parallel" | "chain"; tasks: readonly unknown[] }) => ({
      outcome: "completed" as const,
      mode: request.mode,
      results: request.tasks.map(() => ({ agent: "fixture", task: "fixture", outcome: "completed" as const })),
    }),
  };
}

try {
  // Delegated children receive monotonic depth metadata shared by every execution path.
  const childEnv = buildDelegatedChildEnv("reviewer", {
    [DELEGATION_DEPTH_ENV]: "2",
    [DELEGATION_ROOT_AGENT_ENV]: "scout",
  });
  assert.deepEqual(getDelegationContext(childEnv), {
    depth: 3,
    rootAgent: "scout",
    parentAgent: "reviewer",
  });

  // The generic workflow runtime must fail closed inside a delegated child too,
  // rather than bypassing the interactive subagent tool's nested-call guard.
  const previousDepth = process.env[DELEGATION_DEPTH_ENV];
  const previousRoot = process.env[DELEGATION_ROOT_AGENT_ENV];
  const previousParent = process.env[DELEGATION_PARENT_AGENT_ENV];
  try {
    process.env[DELEGATION_DEPTH_ENV] = "1";
    process.env[DELEGATION_ROOT_AGENT_ENV] = "scout";
    process.env[DELEGATION_PARENT_AGENT_ENV] = "reviewer";
    const blocked = await executeUserScopedSubagentsV1(
      {} as never,
      { mode: "single", tasks: [{ agent: "general", task: "Do not run" }], signal: new AbortController().signal },
      { command: process.execPath, argsPrefix: [], source: "injected" },
    );
    assert.equal(blocked.outcome, "blocked");
    assert.equal(blocked.results.length, 0);
  } finally {
    if (previousDepth === undefined) delete process.env[DELEGATION_DEPTH_ENV]; else process.env[DELEGATION_DEPTH_ENV] = previousDepth;
    if (previousRoot === undefined) delete process.env[DELEGATION_ROOT_AGENT_ENV]; else process.env[DELEGATION_ROOT_AGENT_ENV] = previousRoot;
    if (previousParent === undefined) delete process.env[DELEGATION_PARENT_AGENT_ENV]; else process.env[DELEGATION_PARENT_AGENT_ENV] = previousParent;
  }

  // No viable child launcher means no registration; directories alone also retain sequential fallback.
  const unavailableScope = {};
  assert.equal(registerSubagentExecutionRuntimeV1(unavailableScope, { packageRoot, registeredBy: "unavailable" }).runtime, undefined);
  assert.equal(resolveAgentExecutionRuntimeV1(unavailableScope).outcome, "missing");
  const missingScope = {};
  assert.equal(resolveAgentExecutionRuntimeV1(missingScope).outcome, "missing");
  (globalThis as Record<PropertyKey, unknown>)[Symbol.for("@aefree/pi-subagents/package-agent-directories/v1")] = { protocol: "definitions-only" };
  assert.equal(resolveAgentExecutionRuntimeV1(missingScope).outcome, "missing", "agent definitions are not an execution runtime");

  // An incompatible declaration is reported rather than treated as callable.
  const incompatibleScope = {};
  createCapabilityRegistry({ registryKey: key, contractVersion: 2 }).register(incompatibleScope, {
    contractVersion: 2,
    id: "agents.subagents",
    kind: "agent-execution-runtime",
    owner: { packageName: "@fixture/incompatible", packageVersion: "2.0.0", packageRoot: "/fixture", registeredBy: "fixture" },
  });
  assert.equal(resolveAgentExecutionRuntimeV1(incompatibleScope).outcome, "incompatible");

  // Compatible duplicates fail closed instead of selecting based on extension order.
  const duplicateScope = {};
  const registry = createAgentExecutionRuntimeRegistryV1();
  const first = createSubagentExecutionRuntimeV1(options("first"))!;
  registry.register(duplicateScope, first);
  registry.register(duplicateScope, { ...first, id: "agents.other" });
  assert.equal(resolveAgentExecutionRuntimeV1(duplicateScope).outcome, "duplicate");

  // Registering before workflow is safe; workflow switches only after this registrar exists.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-workflow-runtime-"));
  try {
    const scope = {};
    const before = registerWorkflowRuntimeServicesV1(scope, { packageRoot: root, registeredBy: "workflow" });
    const service = (await import("@aefree/pi-workflow/contracts/v1")).resolveWorkflowServiceV1(scope).records[0]!;
    const context = createScopedWorkflowExecutionContextV1(scope, root, new AbortController().signal);
    assert.equal((await service.preflight(context, { workflow: "plan", targetPaths: [], operation: "read" })).details.mode, "sequential");
    const registration = registerSubagentExecutionRuntimeV1(scope, options("reverse-order"));
    assert.equal((await service.preflight(context, { workflow: "plan", targetPaths: [], operation: "read" })).details.mode, "delegation_available");
    registration.unregister();
    before.unregister();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  // Registrations are session scoped and a delayed old shutdown cannot remove a replacement token.
  const firstScope = {};
  const secondScope = {};
  const firstRegistration = registerSubagentExecutionRuntimeV1(firstScope, options("first-session"));
  const secondRegistration = registerSubagentExecutionRuntimeV1(secondScope, options("second-session"));
  assert.equal(resolveAgentExecutionRuntimeV1(firstScope).outcome, "available");
  assert.equal(resolveAgentExecutionRuntimeV1(secondScope).outcome, "available");
  assert.equal(firstRegistration.unregister(), true);
  assert.equal(resolveAgentExecutionRuntimeV1(secondScope).outcome, "available", "scope teardown must not affect another session");
  const oldRegistration = registerSubagentExecutionRuntimeV1(secondScope, options("old"));
  const replacement = registerSubagentExecutionRuntimeV1(secondScope, options("replacement"));
  assert.equal(oldRegistration.unregister(), false, "an old reload token cannot remove the replacement");
  assert.equal(resolveAgentExecutionRuntimeV1(secondScope).outcome, "available");
  assert.equal(replacement.unregister(), true);
  assert.equal(resolveAgentExecutionRuntimeV1(secondScope).outcome, "missing");
  secondRegistration.unregister();

  // An ordinary Node SDK/test script is never accepted as Pi and never spawns itself.
  assert.equal(findVerifiedPiCliLauncher([process.execPath, fileURLToPath(import.meta.url)], process.execPath), undefined);
  const fakeCliRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-verified-cli-"));
  try {
    const cli = path.join(fakeCliRoot, "dist", "cli.js");
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, "console.log('fixture')\n");
    fs.writeFileSync(path.join(fakeCliRoot, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", bin: { pi: "dist/cli.js" } }));
    const launcher = findVerifiedPiCliLauncher([process.execPath, cli], process.execPath);
    assert.equal(launcher?.source, "verified-pi-cli");
    assert.equal(path.normalize(launcher?.argsPrefix[0] ?? "").toLowerCase(), path.normalize(fs.realpathSync.native(cli)).toLowerCase());
  } finally {
    fs.rmSync(fakeCliRoot, { recursive: true, force: true });
  }
  const verified = findVerifiedPiCliLauncher();
  if (verified === undefined) {
    assert.equal(createSubagentExecutionRuntimeV1({ packageRoot, registeredBy: "deterministic-absence" }), undefined);
  } else {
    const version = execFileSync(verified.command, [...verified.argsPrefix, "--version"], { encoding: "utf8", timeout: 30_000 });
    assert(version.trim().length > 0, "verified Pi CLI smoke must return a version");
  }

  // Owner identity comes from the physical package manifest, not a hard-coded source value.
  const runtime = createSubagentExecutionRuntimeV1(options("owner"))!;
  assert.equal(runtime.owner.packageName, "@aefree/pi-subagents");
  assert.equal(runtime.owner.packageVersion, JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")).version);

  console.log("pi-subagents workflow runtime registration tests passed");
} finally {
  reset();
}
