/** Resolve the calling session's execution providers across preset-owned scopes. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { serviceForAgent } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-subprocess'

/**
 * Identify host execution from the effective session providers.
 * @param ctx - registration context, also used for agentless diagnostics.
 * @param agent - calling session; preset-owned services take precedence over inherited providers.
 * @returns whether both filesystem and subprocess providers execute on the host.
 */
export function isHostExecution(ctx: Context, agent?: Agent): boolean {
  const files = agent === undefined ? ctx.fs : serviceForAgent(ctx, agent, 'fs') ?? ctx.fs
  const processes = agent === undefined ? ctx.subprocess : serviceForAgent(ctx, agent, 'subprocess') ?? ctx.subprocess
  const host = Symbol.for('@deepseek-ai/dsh/host-execution-world')
  return files.executionWorld === host && processes.executionWorld === host
}
