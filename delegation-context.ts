export const DELEGATION_DEPTH_ENV = "PI_SUBAGENT_DELEGATION_DEPTH";
export const DELEGATION_ROOT_AGENT_ENV = "PI_SUBAGENT_ROOT_AGENT";
export const DELEGATION_PARENT_AGENT_ENV = "PI_SUBAGENT_PARENT_AGENT";

export interface DelegationContext {
  readonly depth: number;
  readonly rootAgent: string | null;
  readonly parentAgent: string | null;
}

export function getDelegationContext(env: NodeJS.ProcessEnv = process.env): DelegationContext {
  const rawDepth = env[DELEGATION_DEPTH_ENV];
  const parsedDepth = rawDepth ? Number.parseInt(rawDepth, 10) : 0;
  return Object.freeze({
    depth: Number.isFinite(parsedDepth) && parsedDepth > 0 ? parsedDepth : 0,
    rootAgent: env[DELEGATION_ROOT_AGENT_ENV] || null,
    parentAgent: env[DELEGATION_PARENT_AGENT_ENV] || null,
  });
}

export function buildDelegatedChildEnv(agentName: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const parentContext = getDelegationContext(env);
  return {
    ...env,
    [DELEGATION_DEPTH_ENV]: String(parentContext.depth + 1),
    [DELEGATION_ROOT_AGENT_ENV]: parentContext.rootAgent || agentName,
    [DELEGATION_PARENT_AGENT_ENV]: agentName,
  };
}
