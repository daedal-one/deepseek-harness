import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, expect, it, vi } from 'vitest'
import * as presets from '@deepseek-ai/dsh-agent-presets'
import { executionEnvironment, executionEnvironmentObservation } from '../src/environment.ts'

const host = Symbol.for('@deepseek-ai/dsh/host-execution-world')
afterEach(() => { vi.restoreAllMocks() })

it('keeps VM execution when the profile has only auxiliary host file and process providers', () => {
  const ctx = new Context()
  const world = {}
  ctx.provide('fs', { executionWorld: world } as never)
  ctx.provide('subprocess', { executionWorld: world } as never)
  const auxiliary = vi.fn(() => ({ executionWorld: host }))
  ctx.provide('agentPresets', { serviceFor: auxiliary, hasAgentAdmission: () => false } as never)
  expect(executionEnvironment(ctx, { ctx } as Agent)).toBe('external')
  expect(auxiliary).not.toHaveBeenCalled()
})

it('does not claim isolation for missing, mixed, or unverified external providers', () => {
  const ctx = new Context()
  const agent = { ctx } as Agent
  expect(executionEnvironment(ctx, agent)).toBe('unknown')
  ctx.provide('fs', { executionWorld: host } as never)
  expect(executionEnvironment(ctx, agent)).toBe('unknown')
  const processes = { executionWorld: {} as symbol | object }
  ctx.provide('subprocess', processes as never)
  expect(executionEnvironment(ctx, agent)).toBe('unknown')
  processes.executionWorld = host
  expect(executionEnvironment(ctx, agent)).toBe('host')
})

it('requires the validated container marker and honors the conversation world', () => {
  const ctx = new Context()
  const agent = { ctx } as Agent
  const boot = {}
  const active = {}
  ctx.provide('fs', { executionWorld: active } as never)
  ctx.provide('subprocess', { executionWorld: active } as never)
  expect(executionEnvironment(ctx, agent)).toBe('external')
  ctx.provide('localContainerExecutionWorld', boot)
  expect(executionEnvironment(ctx, agent)).toBe('external')
  ctx.provide('conversationWorkspaces', { executionWorld: active } as never)
  expect(executionEnvironment(ctx, agent)).toBe('container')
})

it('uses profile-owned providers inside the agent execution context', () => {
  const ctx = new Context()
  const agent = { ctx } as Agent
  const world = {}
  let initiated = false
  const provider = { get executionWorld() {
    expect(initiated).toBe(true)
    return world
  } }
  ctx.provide('fs', { executionWorld: host } as never)
  ctx.provide('subprocess', { executionWorld: host } as never)
  const execution = new Context()
  execution.provide('fs', provider as never)
  execution.provide('subprocess', provider as never)
  execution.provide('localContainerExecutionWorld', world)
  vi.spyOn(presets, 'executionContextForAgent').mockReturnValue(execution)
  ctx.provide('agents', { withInitiator(_agent: Agent, run: () => unknown) {
    initiated = true
    try { return run() } finally { initiated = false }
  } } as never)
  expect(executionEnvironment(ctx, agent)).toBe('container')
  expect(initiated).toBe(false)
})

it('assigns no identity without a verified world and one stable identity per world object', () => {
  const ctx = new Context()
  const agent = { ctx } as Agent
  expect(executionEnvironmentObservation(ctx, agent)).toEqual({ environment: 'unknown', environmentId: null })

  const world = {}
  ctx.provide('fs', { executionWorld: world } as never)
  ctx.provide('subprocess', { executionWorld: world } as never)
  const first = executionEnvironmentObservation(ctx, agent)
  expect(first.environment).toBe('external')
  expect(first.environmentId).toMatch(/^env-[0-9a-f]{8}$/)
  expect(executionEnvironmentObservation(ctx, agent).environmentId).toBe(first.environmentId)
})

it('shares one host identity and keeps distinct worlds distinct', () => {
  const ctx = new Context()
  const agent = { ctx } as Agent
  const files = { executionWorld: host as symbol | object }
  const processes = { executionWorld: host as symbol | object }
  ctx.provide('fs', files as never)
  ctx.provide('subprocess', processes as never)
  const hostId = executionEnvironmentObservation(ctx, agent).environmentId
  expect(hostId).toMatch(/^host-[0-9a-f]{8}$/)
  expect(executionEnvironmentObservation(ctx, agent).environmentId).toBe(hostId)

  const other = {}
  files.executionWorld = other
  processes.executionWorld = other
  const otherId = executionEnvironmentObservation(ctx, agent).environmentId
  expect(otherId).toMatch(/^env-[0-9a-f]{8}$/)
  expect(otherId).not.toBe(hostId)
})
