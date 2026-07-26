import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createAgentExecutionRuntimeRegistryV1,
  type AgentExecutionRuntimeV1,
  type WorkflowExecutionContextV1,
  type WorkflowOwnerV1,
} from "@aefree/pi-workflow/contracts/v1";
import { WORKFLOW_RUNTIME_SCOPE_SYMBOL_V1 } from "@aefree/pi-workflow/runtime/v1";
import { discoverAgents, type AgentConfig } from "./agents.js";
import { findVerifiedPiCliLauncher, normalizeInjectedPiLauncher, piInvocation, type PiLauncher } from "./pi-launcher.js";
import { GPT_5_6_SUBAGENT_MODELS } from "./execution-profile.js";
import { buildSubagentSystemPrompt, validateOutputContract } from "./prompting.js";
import { waitForChildExit } from "./extensions/child-process.js";

const MAX_PARALLEL_TASKS = 12;
const RUNTIME_ID = "agents.subagents";

type RuntimeMode = "single" | "parallel" | "chain";
type RuntimeTask = { readonly agent: string; readonly task: string };
type RuntimeRequest = { readonly mode: RuntimeMode; readonly tasks: readonly RuntimeTask[]; readonly signal: AbortSignal };

export interface SubagentRuntimeResult {
  readonly outcome: "completed" | "blocked" | "failed";
  readonly mode: RuntimeMode;
  readonly results: readonly {
    readonly agent: string;
    readonly task: string;
    readonly outcome: "completed" | "failed";
    readonly output?: string;
    readonly code?: string;
  }[];
}

/**
 * Deliberately does not accept a Pi session, API, model registry, UI, or trust
 * callback. The workflow contract can safely invoke it later with only its
 * invocation context. It executes user-scoped agents; project-controlled
 * agents remain on the interactive `subagent` tool's trust-gated path.
 */
export type SubagentRuntimeExecutor = (
  context: WorkflowExecutionContextV1,
  request: RuntimeRequest,
) => Promise<SubagentRuntimeResult>;

export interface AgentExecutionRuntimeRegistrationOptions {
  readonly packageRoot: string;
  readonly registeredBy: string;
  readonly execute?: SubagentRuntimeExecutor;
  /** Explicit launcher injection for SDK hosts; omitted only in a verified Pi CLI process. */
  readonly launcher?: Omit<PiLauncher, "source"> & { readonly source?: "injected" };
}

export function readSubagentPackageOwner(packageRoot: string, registeredBy: string): WorkflowOwnerV1 {
  const manifestPath = path.join(packageRoot, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { name?: unknown; version?: unknown };
  if (typeof manifest.name !== "string" || manifest.name.trim() === "") throw new Error("pi-subagents package name is missing.");
  if (typeof manifest.version !== "string" || manifest.version.trim() === "") throw new Error("pi-subagents package version is missing.");
  return Object.freeze({
    packageName: manifest.name,
    packageVersion: manifest.version,
    packageRoot: fs.realpathSync.native(packageRoot),
    registeredBy,
  });
}

/** True only in a positively verified Pi CLI host. SDK/test hosts must inject a launcher explicitly. */
export function isSubagentExecutionAvailable(): boolean {
  return findVerifiedPiCliLauncher() !== undefined;
}

export function createSubagentExecutionRuntimeV1(options: AgentExecutionRuntimeRegistrationOptions): AgentExecutionRuntimeV1 | undefined {
  const launcher = options.launcher === undefined ? findVerifiedPiCliLauncher() : normalizeInjectedPiLauncher(options.launcher);
  if (launcher === undefined) return undefined;
  const owner = readSubagentPackageOwner(options.packageRoot, options.registeredBy);
  const execute = options.execute ?? ((context, request) => executeUserScopedSubagentsV1(context, request, launcher));
  return Object.freeze({
    contractVersion: 1,
    id: RUNTIME_ID,
    kind: "agent-execution-runtime",
    owner,
    modes: Object.freeze(["single", "parallel", "chain"] as const),
    execute(context, request) {
      return execute(context, request);
    },
  });
}

/** Register once in one session scope. The token prevents an old reload from removing a newer registration. */
export function registerSubagentExecutionRuntimeV1(scope: object, options: AgentExecutionRuntimeRegistrationOptions): Readonly<{ runtime?: AgentExecutionRuntimeV1; unregister: () => boolean }> {
  const runtime = createSubagentExecutionRuntimeV1(options);
  if (runtime === undefined) return Object.freeze({ unregister: () => false });
  const registry = createAgentExecutionRuntimeRegistryV1();
  const token = registry.register(scope, runtime);
  let active = true;
  return Object.freeze({
    runtime,
    unregister: () => {
      if (!active) return false;
      active = false;
      return registry.unregister(token);
    },
  });
}

export async function executeUserScopedSubagentsV1(
  context: WorkflowExecutionContextV1,
  request: RuntimeRequest,
  launcher: PiLauncher | undefined = findVerifiedPiCliLauncher(),
): Promise<SubagentRuntimeResult> {
  if (request.signal.aborted) return Object.freeze({ outcome: "blocked", mode: request.mode, results: Object.freeze([]) });
  validateRequest(request);
  if (launcher === undefined) return Object.freeze({ outcome: "blocked", mode: request.mode, results: Object.freeze([]) });
  // Generic workflow calls cannot present Pi's project-trust confirmation UI.
  // Restricting them to user scope keeps repository-controlled prompts out.
  const sessionScope = (context as WorkflowExecutionContextV1 & { readonly [WORKFLOW_RUNTIME_SCOPE_SYMBOL_V1]?: object })[WORKFLOW_RUNTIME_SCOPE_SYMBOL_V1];
  const agents = discoverAgents(context.cwd, "user", { sessionScope }).agents;
  const byName = new Map(agents.map((agent) => [agent.name, agent]));
  const unresolved = request.tasks.find((task) => !byName.has(task.agent));
  if (unresolved) {
    return Object.freeze({
      outcome: "blocked",
      mode: request.mode,
      results: Object.freeze([{ agent: unresolved.agent, task: unresolved.task, outcome: "failed", code: "agent_unavailable" }]),
    });
  }

  if (request.mode === "parallel") {
    const results = await Promise.all(request.tasks.map((task) => executeOne(byName.get(task.agent)!, task, context, request.signal, launcher)));
    return aggregate(request.mode, results);
  }

  const results: SubagentRuntimeResult["results"][number][] = [];
  let previous = "";
  for (const item of request.tasks) {
    const task = { ...item, task: item.task.replaceAll("{previous}", previous) };
    const result = await executeOne(byName.get(item.agent)!, task, context, request.signal, launcher);
    results.push(result);
    if (result.outcome === "failed") return aggregate(request.mode, results);
    previous = result.output ?? "";
  }
  return aggregate(request.mode, results);
}

function validateRequest(request: RuntimeRequest): void {
  if (!Array.isArray(request.tasks) || request.tasks.length === 0) throw new TypeError("Agent runtime requires at least one task.");
  if (request.mode === "single" && request.tasks.length !== 1) throw new TypeError("Single agent runtime mode requires exactly one task.");
  if (request.mode === "parallel" && request.tasks.length > MAX_PARALLEL_TASKS) throw new TypeError(`Parallel agent runtime mode allows at most ${MAX_PARALLEL_TASKS} tasks.`);
  for (const task of request.tasks) {
    if (!task || typeof task.agent !== "string" || task.agent.trim() === "" || typeof task.task !== "string" || task.task.trim() === "") {
      throw new TypeError("Agent runtime tasks require non-empty agent and task strings.");
    }
  }
}

async function executeOne(agent: AgentConfig, task: RuntimeTask, context: WorkflowExecutionContextV1, signal: AbortSignal, launcher: PiLauncher): Promise<SubagentRuntimeResult["results"][number]> {
  // The generic contract has no parent model registry to safely inherit from.
  // Only an explicit supported pin is therefore executable on this path.
  if (agent.model === undefined) return { agent: task.agent, task: task.task, outcome: "failed", code: "model_not_pinned" };
  if (!GPT_5_6_SUBAGENT_MODELS.includes(agent.model as typeof GPT_5_6_SUBAGENT_MODELS[number])) {
    return { agent: task.agent, task: task.task, outcome: "failed", code: "unsupported_model" };
  }
  let temporaryDirectory: string | undefined;
  try {
    const args = ["--mode", "json", "-p", "--no-session"];
    if (agent.model) args.push("--model", agent.model);
    if (agent.tools?.length) args.push("--tools", agent.tools.join(","));
    const systemPrompt = buildSubagentSystemPrompt(agent);
    if (systemPrompt.trim()) {
      temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-runtime-"));
      const promptPath = path.join(temporaryDirectory, "system.md");
      await fs.promises.writeFile(promptPath, systemPrompt, { encoding: "utf8", mode: 0o600 });
      args.push("--append-system-prompt", promptPath);
    }
    args.push(task.task);
    const output = await spawnPi(piInvocation(launcher, args), context.cwd, signal, buildDelegatedChildEnv(agent.name));
    if (output.exitCode !== 0 || output.wasAborted) return { agent: task.agent, task: task.task, outcome: "failed", code: output.wasAborted ? "aborted" : "child_failed" };
    const validation = validateOutputContract(agent, output.finalOutput);
    if (!validation.ok) return { agent: task.agent, task: task.task, outcome: "failed", code: "output_contract_failed" };
    return { agent: task.agent, task: task.task, outcome: "completed", output: output.finalOutput };
  } catch {
    return { agent: task.agent, task: task.task, outcome: "failed", code: "runtime_error" };
  } finally {
    if (temporaryDirectory) await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function aggregate(mode: RuntimeMode, results: readonly SubagentRuntimeResult["results"][number][]): SubagentRuntimeResult {
  return Object.freeze({ outcome: results.every((result) => result.outcome === "completed") ? "completed" : "failed", mode, results: Object.freeze([...results]) });
}

function buildDelegatedChildEnv(agentName: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const depth = Number.parseInt(env.PI_SUBAGENT_DELEGATION_DEPTH ?? "0", 10);
  return {
    ...env,
    PI_SUBAGENT_DELEGATION_DEPTH: String(Number.isFinite(depth) && depth > 0 ? depth + 1 : 1),
    PI_SUBAGENT_ROOT_AGENT: env.PI_SUBAGENT_ROOT_AGENT || agentName,
    PI_SUBAGENT_PARENT_AGENT: agentName,
  };
}

async function spawnPi(invocation: { command: string; args: string[] }, cwd: string, signal: AbortSignal, env: NodeJS.ProcessEnv): Promise<{ exitCode: number; wasAborted: boolean; finalOutput: string }> {
  return await new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let buffer = "";
    let finalOutput = "";
    const line = (value: string) => {
      try {
        const event = JSON.parse(value) as { type?: string; message?: { role?: string; content?: Array<{ type?: string; text?: string }> } };
        if (event.type === "message_end" && event.message?.role === "assistant") {
          const text = event.message.content?.find((part) => part.type === "text")?.text;
          if (typeof text === "string") finalOutput = text;
        }
      } catch { /* JSON mode can emit non-protocol diagnostics. */ }
    };
    child.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const value of lines) if (value.trim()) line(value);
    });
    void waitForChildExit(child, { signal, onClose: () => { if (buffer.trim()) line(buffer); } })
      .then(({ exitCode, wasAborted }) => resolve({ exitCode, wasAborted, finalOutput }));
  });
}
