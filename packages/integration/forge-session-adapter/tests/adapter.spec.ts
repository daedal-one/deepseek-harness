import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import UserApproval from '@deepseek-ai/dsh-user-approval'
import { SessionId } from '@deepseek-ai/dsh-session'
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
      executor_lease_id: 'agent-0123456789abcdef01234567',
    },
  }
}

describe('Forge session adapter composition', () => {
  it.each([false, true])('preserves exact intent and recovery=%s through checkpoints, retries and restart', async (recovered) => {
    const state = await root()
    const workspace = join(state, 'workspaces', 'session')
    await mkdir(workspace, { recursive: true })
    const canonicalWorkspace = await realpath(workspace)
    const createContext = async (): Promise<Context> => {
      const ctx = new Context()
      await mountAgentLoopTestDependencies(ctx)
      const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'action-mcp.mjs')
      const configFile = join(state, 'cordis.yml')
      await writeFile(configFile, JSON.stringify([
        { name: 'persistence', config: { root: join(state, 'sessions'), compression: 'none' } },
        { name: 'agent-loop', config: { agents: [] } },
        { name: 'subprocess' }, { name: 'approval', config: { policy: 'ask' } },
        { name: 'webserver', config: { host: '127.0.0.1', port: 0 } },
        { name: 'forge-adapter', config: {
          token: 'test-adapter-token', stateFile: join(state, 'adapter.json'),
          routePrefix: '/v1', maxRequestBytes: 1024 * 1024,
          intellectCommand: process.env.FORGE_TEST_ACTION_MCP ?? process.execPath,
          intellectCommandPrefixArgs: process.env.FORGE_TEST_ACTION_MCP ? [] : [fixture],
          intellectStateRoot: join(state, 'intellect'),
          intellectGraphDb: join(state, 'intellect', 'graph.sqlite'),
          intellectExcludes: ['.git'], intellectToolCallTimeoutMs: 10_000,
          credentialSocketRoot: join(state, 'credentials'), commandSandbox: 'disabled',
          commandReadRoots: ['/usr', '/bin'],
        } },
      ]))
      const modules = new Map<string, unknown>([
        ['persistence', JsonlSessionPersistence], ['agent-loop', AgentLoop],
        ['subprocess', LocalSubprocessRuntime], ['approval', UserApproval],
        ['webserver', WebServer], ['forge-adapter', ForgeSessionAdapter],
      ])
      await ctx.plugin(Loader)
      ctx.loader.builtins.include = Include
      ctx.loader.internal = {
        version: 'v2',
        async import(specifier: string) {
          if (!modules.has(specifier)) throw new Error(`unexpected module ${specifier}`)
          return modules.get(specifier)
        },
      } as unknown as NonNullable<typeof ctx.loader.internal>
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configFile).href } })
      await ctx.loader.await()
      return ctx
    }
    let ctx = await createContext()
    const headers = { 'x-forge-adapter-token': 'test-adapter-token', 'content-type': 'application/json' }
    const bearerOnly = await fetch(`http://127.0.0.1:${ctx.webServer.port}/v1/capabilities`, {
      headers: { authorization: 'Bearer test-adapter-token' },
    })
    expect(bearerOnly.status).toBe(401)
    const authenticated = await fetch(`http://127.0.0.1:${ctx.webServer.port}/v1/capabilities`, { headers })
    expect(authenticated.status).toBe(200)
    const capability = await authenticated.json() as {
      spec_baselines: string[]
      recovery_protocols: string[]
      action_tools_protocol: string
    }
    expect(capability.spec_baselines).toMatchInlineSnapshot(`
      [
        "forge-spec-v0.6.0",
        "forge-spec-v0.7.0",
      ]
    `)
    expect(capability.recovery_protocols).toEqual(['forge.executor.recovery/v1'])
    expect(capability.action_tools_protocol).toBe('forge-intellect-action-tools/v2')
    const sessionId = 'forge-session-test'
    const rendered = '<spec-bundle id="TASK:work" />\n'
    const intent = {
      protocol: 'forge.spec.preflight/v1',
      baseline: 'forge-spec-v0.7.0',
      workspace_revision: 'a'.repeat(40),
      target: 'TASK:work',
      rendered,
      rendered_sha256: createHash('sha256').update(rendered).digest('hex'),
      lint_errors: 0,
      evidence: { protocol: 'forge.intellect.action/v2', action_id: 'action-1', digest: 'digest-1' },
    }
    const execution = recovered ? {
      protocol: 'forge.executor.recovery/v1', lease_id: 'agent-0123456789abcdef01234567',
      checkpoint_id: 'checkpoint-agent-fedcba9876543210fedcba98-abcdef012345',
      checkpoint_digest: 'c'.repeat(64), source_revision: 'b'.repeat(40), tree_digest: 'd'.repeat(64),
      intent_revision: 'a'.repeat(40),
      evidence: { protocol: 'forge.intellect.action/v2', action_id: 'recovery-action', digest: 'e'.repeat(64) },
    } : undefined
    const startPayload = { intent, ...execution === undefined ? {} : { execution } }
    let url = `http://127.0.0.1:${ctx.webServer.port}/v1/sessions/${sessionId}/commands`
    const startRequest = command(canonicalWorkspace, sessionId, 'start-1', 'start', startPayload)
    const invalidStart = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify(command(canonicalWorkspace, sessionId, 'invalid-start', 'start', { intent, execution: { protocol: 'unknown' } })),
    })
    expect(invalidStart.status).toBe(409)
    expect(ctx.sessions.get(SessionId(sessionId))).toBeUndefined()
    expect((await fetch(url.replace('/commands', ''), { headers })).status).toBe(404)
    const started = await fetch(url, { method: 'POST', headers, body: JSON.stringify(startRequest) })
    expect(started.status).toBe(200)
    const startBody = await started.json() as {
      status: string
      events: { protocol: string; sequence: number; data: Record<string, unknown> }[]
    }
    expect(startBody.status).toBe('idle')
    expect(startBody.events.every(event => event.protocol === 'forge.agent.session/v1')).toBe(true)

    expect(startBody.events.every(event => JSON.stringify(event.data.execution) === JSON.stringify(execution))).toBe(true)
    const history = JSON.stringify(ctx.sessions.get(SessionId(sessionId))?.events)
    expect(history).toContain(`Intent revision: ${'a'.repeat(40)}`)
    if (recovered) {
      expect(history).toContain(`Recovered source revision: ${'b'.repeat(40)}`)
      expect(history).toContain('does not replace accepted intent')
    }
    const changedStart = command(canonicalWorkspace, sessionId, 'start-1', 'start', {
      ...startPayload, execution: execution === undefined ? { protocol: 'unknown' } : { ...execution, tree_digest: 'f'.repeat(64) },
    })
    const changedReplay = await fetch(url, { method: 'POST', headers, body: JSON.stringify(changedStart) })
    expect(changedReplay.status).toBe(409)
    if (recovered) {
      const removedReceipt = await fetch(url, {
        method: 'POST', headers, body: JSON.stringify(command(canonicalWorkspace, sessionId, 'start-1', 'start', { intent })),
      })
      expect(removedReceipt.status).toBe(409)
    }
    const checkpointRequest = command(canonicalWorkspace, sessionId, 'checkpoint-1', 'checkpoint', {})
    const checkpointed = await fetch(url, { method: 'POST', headers, body: JSON.stringify(checkpointRequest) })
    expect(checkpointed.status).toBe(200)
    const checkpointBody = await checkpointed.json() as { evidence: { protocol_version: string }; events: { sequence: number }[] }
    expect(checkpointBody.evidence.protocol_version).toBe('forge-intellect-action-tools/v2')
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

    const stateOnDisk = JSON.parse(await readFile(join(state, 'adapter.json'), 'utf8')) as {
      sessions: Record<string, { execution?: unknown }>
    }
    expect(stateOnDisk.sessions[sessionId]?.execution).toEqual(execution)
    await ctx.fiber.dispose()
    ctx = await createContext()
    url = `http://127.0.0.1:${ctx.webServer.port}/v1/sessions/${sessionId}/commands`
    const inspected = await fetch(url.replace('/commands', ''), { headers })
    expect(await inspected.json()).toMatchObject({
      intent_revision: 'a'.repeat(40), status: 'recoverable', ...execution === undefined ? {} : { execution },
    })
    const changedAfterRestart = await fetch(url, { method: 'POST', headers, body: JSON.stringify(changedStart) })
    expect(changedAfterRestart.status).toBe(409)
    const restoredCheckpoint = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify(command(canonicalWorkspace, sessionId, 'checkpoint-restored', 'checkpoint', {})),
    })
    const restoredBody = await restoredCheckpoint.json() as { status: string; events: { data: Record<string, unknown> }[] }
    expect(restoredBody.status).toBe('idle')
    expect(restoredBody.events.every(event => JSON.stringify(event.data.execution) === JSON.stringify(execution))).toBe(true)
    const lateExecution = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify(command(canonicalWorkspace, sessionId, 'checkpoint-late', 'checkpoint', { execution: execution ?? {} })),
    })
    expect(lateExecution.status).toBe(409)
    const credentialSession = 'forge-session-credential'
    const missingCredential = command(
      canonicalWorkspace,
      credentialSession,
      'start-credential-1',
      'start',
      { intent },
    ) as { executor_policy: { credential_scopes: string[]; executor_lease_id: string } }
    missingCredential.executor_policy.credential_scopes = ['forgejo:project:write']
    missingCredential.executor_policy.executor_lease_id = 'agent-fedcba9876543210fedcba98'
    const credentialResponse = await fetch(
      `http://127.0.0.1:${ctx.webServer.port}/v1/sessions/${credentialSession}/commands`,
      { method: 'POST', headers, body: JSON.stringify(missingCredential) },
    )
    expect(credentialResponse.status).toBe(200)
    expect(await credentialResponse.json()).toMatchObject({ outcome: 'policy_denied' })
    await ctx.fiber.dispose()
  })
})
