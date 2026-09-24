/** Observe execution placement independently of the permission table. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-local-container-runtime'
import type {} from '@deepseek-ai/dsh-local-container-runtime/startup'
import type {} from '@deepseek-ai/dsh-local-container-runtime/workspaces'
import type { ExecutionEnvironment } from './types.ts'

/**
 * Classify an agent's filesystem and processes using their shared execution identity.
 * @param ctx - host services and optional profile registry.
 * @param agent - agent whose profile-owned providers take precedence.
 * @returns container only with a verified container marker; mixed or absent providers remain unknown.
 */
export function executionEnvironment(ctx: Context, agent: Agent): ExecutionEnvironment {
  const presets = ctx.get('agentPresets')
  const service = <K extends string & keyof Context>(name: K): Context[K] | undefined =>
    presets?.serviceFor(agent, name) ?? ctx.get(name)
  const files = service('fs')
  const processes = service('subprocess')
  if (files === undefined || processes === undefined) return 'unknown'
  const observe = (): ExecutionEnvironment => {
    const world = files.executionWorld
    if (world !== processes.executionWorld) return 'unknown'
    if (world === Symbol.for('@deepseek-ai/dsh/host-execution-world')) return 'host'
    const verified = service('localContainerExecutionWorld')
    const container = verified === undefined ? undefined : service('conversationWorkspaces')?.executionWorld ?? verified
    return world === container ? 'container' : 'external'
  }
  const agents = ctx.get('agents')
  return agents === undefined ? observe() : agents.withInitiator(agent, observe)
}
