import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import UserApproval from '@deepseek-ai/dsh-user-approval'
import { afterEach, describe, expect, it } from 'vitest'
import ForgeSessionAdapter from '../src/index.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-forge-adapter-'))
  roots.push(value)
  return value
}

function command(workspace: string, sessionId: string, key: string, name: string, payload: object): object {
  return {
    protocol: 'forge.agent.session/v1',
    session_id: sessionId,
    project_id: 'PROJECT:forge',
    work_id: 'TASK:work',
    intent_revision: 'a'.repeat(40),
    causality_id: 'cause-1',
    command: name,
    idempotency_key: key,
    payload,
    executor_policy: {
      max_minutes: 60,
      network: 'none',
      tools: ['git', 'spec'],
      credential_scopes: [],
      workspace,
    },
  }
}

describe('Forge session adapter composition', () => {
  it('starts from exact Spec intent, exposes Intellect checkpoints, and replays idempotently', async () => {
    const state = await root()
    const workspace = join(state, 'workspaces', 'session')
    await mkdir(workspace, { recursive: true })
    const canonicalWorkspace = await realpath(workspace)
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root: join(state, 'sessions'), compression: 'none' })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(UserApproval, { policy: 'ask' })
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'action-mcp.mjs')
    await ctx.plugin(ForgeSessionAdapter, {
      token: 'test-adapter-token',
      stateFile: join(state, 'adapter.json'),
      routePrefix: '/v1',
      maxRequestBytes: 1024 * 1024,
      intellectCommand: process.execPath,
      intellectCommandPrefixArgs: [fixture],
      intellectStateRoot: join(state, 'intellect'),
      intellectGraphDb: join(state, 'intellect', 'graph.sqlite'),
      intellectExcludes: ['.git'],
      intellectToolCallTimeoutMs: 10_000,
    })
    const headers = { authorization: 'Bearer test-adapter-token', 'content-type': 'application/json' }
    const sessionId = 'forge-session-test'
    const rendered = '<spec-bundle id="TASK:work" />\n'
    const intent = {
      protocol: 'forge.spec.preflight/v1',
      baseline: 'forge-spec-v0.6.0',
      workspace_revision: 'a'.repeat(40),
      target: 'TASK:work',
      rendered,
      rendered_sha256: createHash('sha256').update(rendered).digest('hex'),
      lint_errors: 0,
      evidence: { protocol: 'forge.intellect.action/v2', action_id: 'action-1', digest: 'digest-1' },
    }
    const url = `http://127.0.0.1:${ctx.webServer.port}/v1/sessions/${sessionId}/commands`
    const startRequest = command(canonicalWorkspace, sessionId, 'start-1', 'start', { intent })
    const started = await fetch(url, { method: 'POST', headers, body: JSON.stringify(startRequest) })
    expect(started.status).toBe(200)
    const startBody = await started.json() as { status: string; events: { protocol: string; sequence: number }[] }
    expect(startBody.status).toBe('idle')
    expect(startBody.events.every(event => event.protocol === 'forge.agent.session/v1')).toBe(true)

    const checkpointRequest = command(canonicalWorkspace, sessionId, 'checkpoint-1', 'checkpoint', {})
    const checkpointed = await fetch(url, { method: 'POST', headers, body: JSON.stringify(checkpointRequest) })
    expect(checkpointed.status).toBe(200)
    const checkpointBody = await checkpointed.json() as { evidence: { protocol_version: string }; events: { sequence: number }[] }
    expect(checkpointBody.evidence.protocol_version).toBe('forge-intellect-action-tools/v1')
    expect(checkpointBody.events.at(-1)?.sequence).toBeGreaterThan(startBody.events.at(-1)?.sequence ?? 0)

    const replayed = await fetch(url, { method: 'POST', headers, body: JSON.stringify(checkpointRequest) })
    expect(await replayed.json()).toEqual(checkpointBody)

    const changedPolicy = command(canonicalWorkspace, sessionId, 'checkpoint-2', 'checkpoint', {}) as {
      executor_policy: { tools: string[] }
    }
    changedPolicy.executor_policy.tools = ['git', 'spec', 'workspace_apply']
    const rejected = await fetch(url, { method: 'POST', headers, body: JSON.stringify(changedPolicy) })
    expect(rejected.status).toBe(409)
    expect(await rejected.json()).toMatchObject({ outcome: 'policy_denied' })
    await ctx.fiber.dispose()
  })
})
