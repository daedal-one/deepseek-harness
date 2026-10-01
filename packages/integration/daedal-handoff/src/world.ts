/** Resolve the calling session's execution providers across preset-owned scopes. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { executionContextForAgent } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-subprocess'

/**
 * Identify host execution from the effective session providers.
 * @param ctx - registration context, also used for agentless diagnostics.
 * @param agent - calling session; preset-owned services take precedence over inherited providers.
 * @returns whether both filesystem and subprocess providers execute on the host.
 */
export function isHostExecution(ctx: Context, agent?: Agent): boolean {
  const execution = agent === undefined ? ctx : executionContextForAgent(ctx, agent)
  const files = execution.get('fs')
  const processes = execution.get('subprocess')
  const host = Symbol.for('@deepseek-ai/dsh/host-execution-world')
  const observe = (): boolean => files?.executionWorld === host && processes?.executionWorld === host
  return agent === undefined ? observe() : ctx.agents.withInitiator(agent, observe)
}
