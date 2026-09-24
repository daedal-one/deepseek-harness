import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { expect, it } from 'vitest'
import { executionEnvironment } from '../src/environment.ts'

const host = Symbol.for('@deepseek-ai/dsh/host-execution-world')

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
  ctx.provide('agentPresets', { serviceFor(_agent: Agent, name: string) {
    if (name === 'fs' || name === 'subprocess') return provider
    if (name === 'localContainerExecutionWorld') return world
    return undefined
  } } as never)
  ctx.provide('agents', { withInitiator(_agent: Agent, run: () => unknown) {
    initiated = true
    try { return run() } finally { initiated = false }
  } } as never)
  expect(executionEnvironment(ctx, agent)).toBe('container')
  expect(initiated).toBe(false)
})
