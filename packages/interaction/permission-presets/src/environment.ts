/** Observe execution placement and a process-local world identity independently of the permission table. @module */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { executionContextForAgent } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-local-container-runtime'
import type {} from '@deepseek-ai/dsh-local-container-runtime/startup'
import type {} from '@deepseek-ai/dsh-local-container-runtime/workspaces'
import type { ExecutionEnvironment } from './types.ts'

/** Host execution world shared by the local filesystem and subprocess providers. */
const HOST_WORLD = Symbol.for('@deepseek-ai/dsh/host-execution-world')

/**
 * Verified execution placement beside the process-local identity of the world
 * it was observed from. Two Sessions whose observations carry the same
 * `environmentId` resolve to the same world object on this Host; identities
 * are process-local and never durable, so a restarted Host or recreated
 * container names a new world.
 */
export interface ExecutionEnvironmentObservation {
  /** Verified execution placement of the Session's providers. */
  readonly environment: ExecutionEnvironment
  /** Process-local identity of that world, or `null` when no world is named. */
  readonly environmentId: string | null
}

/**
 * Identities already assigned to one execution world object. Provider worlds
 * are process-local objects, so a WeakMap holds an assignment exactly as long
 * as its world and records no provider identity durably.
 */
const worldIds = new WeakMap<object, string>()
let hostWorldId: string | undefined

/**
 * Read or assign the process-local identity of one execution world.
 * @param world - the value both execution providers expose as their world.
 * @returns the assigned identity, or `null` for a world this process cannot name.
 */
function identityOf(world: symbol | object): string | null {
  if (world === HOST_WORLD) {
    hostWorldId ??= `host-${randomUUID().slice(0, 8)}`
    return hostWorldId
  }
  if (typeof world === 'symbol') return null
  const existing = worldIds.get(world)
  if (existing !== undefined) return existing
  const assigned = `env-${randomUUID().slice(0, 8)}`
  worldIds.set(world, assigned)
  return assigned
}

/**
 * Classify an agent's filesystem and processes using their shared execution identity.
 * @param ctx - host services and optional profile registry.
 * @param agent - agent whose profile-owned providers take precedence.
 * @returns container only with a verified container marker; mixed or absent providers remain unknown.
 */
export function executionEnvironment(ctx: Context, agent: Agent): ExecutionEnvironment {
  return executionEnvironmentObservation(ctx, agent).environment
}

/**
 * Observe the placement and the process-local world identity an agent's
 * filesystem and processes share. Both facts come from one reading, so they
 * cannot disagree about which world was verified.
 * @param ctx - host services and optional profile registry.
 * @param agent - agent whose profile-owned providers take precedence, identified for ambient consumers.
 * @returns the verified placement beside that world's identity.
 */
export function executionEnvironmentObservation(ctx: Context, agent: Agent): ExecutionEnvironmentObservation {
  const execution = executionContextForAgent(ctx, agent)
  const service = <K extends string & keyof Context>(name: K): Context[K] | undefined => execution.get(name)
  const files = service('fs')
  const processes = service('subprocess')
  if (files === undefined || processes === undefined) return { environment: 'unknown', environmentId: null }
  const observe = (): ExecutionEnvironmentObservation => {
    const world = files.executionWorld
    if (world !== processes.executionWorld) return { environment: 'unknown', environmentId: null }
    if (world === HOST_WORLD) return { environment: 'host', environmentId: identityOf(world) }
    const verified = service('localContainerExecutionWorld')
    const container = verified === undefined ? undefined : service('conversationWorkspaces')?.executionWorld ?? verified
    return { environment: world === container ? 'container' : 'external', environmentId: identityOf(world) }
  }
  const agents = ctx.get('agents')
  return agents === undefined ? observe() : agents.withInitiator(agent, observe)
}
