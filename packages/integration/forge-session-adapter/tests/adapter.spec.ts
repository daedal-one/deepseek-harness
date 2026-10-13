import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
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
import ForgeSessionAdapter, { type Config } from '../src/index.ts'

const fixtureDir = dirname(fileURLToPath(import.meta.url))
const headers = { 'x-forge-adapter-token': 'test-adapter-token', 'content-type': 'application/json' }

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-forge-adapter-'))
  roots.push(value)
  return value
}

async function mount(state: string, extra: Partial<Config> = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(state, 'sessions'), compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(UserApproval, { policy: 'ask' })
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(ForgeSessionAdapter, {
    token: 'test-adapter-token',
    stateFile: join(state, 'adapter.json'),
    routePrefix: '/v1',
    maxRequestBytes: 1024 * 1024,
    intellectCommand: process.execPath,
    intellectCommandPrefixArgs: [join(fixtureDir, 'fixtures', 'action-mcp.mjs')],
    intellectStateRoot: join(state, 'intellect'),
    intellectGraphDb: join(state, 'intellect', 'graph.sqlite'),
    intellectExcludes: ['.git'],
    intellectToolCallTimeoutMs: 10_000,
    credentialSocketRoot: join(state, 'credentials'),
    commandSandbox: 'disabled',
    commandReadRoots: ['/usr', '/bin'],
    ...extra,
  })
  contexts.push(ctx)
  return ctx
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

function digest(contents: string): string {
  return createHash('sha256').update(contents).digest('hex')
}

function preflight(rendered: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocol: 'forge.spec.preflight/v1',
    baseline: 'forge-spec-v0.7.0',
    workspace_revision: 'a'.repeat(40),
    target: 'TASK:work',
    rendered,
    rendered_sha256: digest(rendered),
    lint_errors: 0,
    evidence: { protocol: 'forge.intellect.action/v2', action_id: 'action-1', digest: 'digest-1' },
    ...overrides,
  }
}

async function specTree(root: string, files: Record<string, string>): Promise<string> {
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(root, relative)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
  }
  return root
}

async function start(
  ctx: Context,
  workspace: string,
  sessionId: string,
  intent: Record<string, unknown>,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${ctx.webServer.port}/v1/sessions/${sessionId}/commands`, {
    method: 'POST',
    headers,
    body: JSON.stringify(command(workspace, sessionId, 'start-1', 'start', { intent })),
  })
}

async function startedBody(response: Response): Promise<{
  status: string
  outcome?: string
  events: { type: string; data: { error?: string } }[]
}> {
  expect(response.status).toBe(200)
  return await response.json() as {
    status: string
    outcome?: string
    events: { type: string; data: { error?: string } }[]
  }
}

function failureMessage(body: { events: { type: string; data: { error?: string } }[] }): string {
  return body.events.find(event => event.type === 'command.failed')?.data.error ?? ''
}

function repositoryRoot(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: fixtureDir, encoding: 'utf8' }).trim()
}

describe('Forge session adapter composition', () => {
  it('starts from exact Spec intent, exposes Intellect checkpoints, and replays idempotently', async () => {
    const state = await root()
    const workspace = join(state, 'workspaces', 'session')
    await mkdir(workspace, { recursive: true })
    const canonicalWorkspace = await realpath(workspace)
    const ctx = await mount(state)
    const bearerOnly = await fetch(`http://127.0.0.1:${ctx.webServer.port}/v1/capabilities`, {
      headers: { authorization: 'Bearer test-adapter-token' },
    })
    expect(bearerOnly.status).toBe(401)
    const authenticated = await fetch(`http://127.0.0.1:${ctx.webServer.port}/v1/capabilities`, { headers })
    expect(authenticated.status).toBe(200)
    const sessionId = 'forge-session-test'
    const rendered = '<spec-bundle id="TASK:work" />\n'
    const intent = preflight(rendered)
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
  })

  it('starts from an extended preflight whose committed spec digests and repo revision match', async () => {
    const state = await root()
    const workspace = join(state, 'workspaces', 'session')
    await mkdir(workspace, { recursive: true })
    const canonicalWorkspace = await realpath(workspace)
    const one = '---\nid: REQ:forge/one\ntype: requirement\nstatus: draft\n---\n\n# One\n'
    const two = '---\nid: REQ:forge/two\ntype: requirement\nstatus: draft\n---\n\n# Two\n'
    const specsRoot = await specTree(join(state, '.specs'), {
      'REQ-one.spec.md': one,
      'nested/REQ-two.spec.md': two,
      'notes.txt': 'not a spec\n',
      'no-frontmatter.spec.md': '# no frontmatter\n',
      'no-id.spec.md': '---\ntype: requirement\n---\n\n# No id\n',
    })
    const repoRoot = repositoryRoot()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
    const ctx = await mount(state, { specsRoot, repoRoot })
    const refsOnly = await start(ctx, canonicalWorkspace, 'forge-session-refs', preflight('<spec-bundle />\n', {
      specRefs: [
        { id: 'REQ:forge/one', digest: digest(one) },
        { id: 'REQ:forge/two', digest: digest(two) },
      ],
    }))
    expect((await startedBody(refsOnly)).status).toBe('idle')

    const withRevision = await start(ctx, canonicalWorkspace, 'forge-session-extended', preflight('<spec-bundle />\n', {
      specRefs: [{ id: 'REQ:forge/one', digest: digest(one) }],
      repoRevision: head,
    }))
    expect((await startedBody(withRevision)).status).toBe('idle')
  })

  it('refuses a start whose committed spec bytes no longer match the declared digest', async () => {
    const state = await root()
    const workspace = join(state, 'workspaces', 'session')
    await mkdir(workspace, { recursive: true })
    const canonicalWorkspace = await realpath(workspace)
    const one = '---\nid: REQ:forge/one\ntype: requirement\nstatus: draft\n---\n\n# One\n'
    const specsRoot = await specTree(join(state, '.specs'), { 'REQ-one.spec.md': one })
    const ctx = await mount(state, { specsRoot })
    const response = await start(ctx, canonicalWorkspace, 'forge-session-drift', preflight('<spec-bundle />\n', {
      specRefs: [{ id: 'REQ:forge/one', digest: digest('different bytes') }],
    }))
    const body = await startedBody(response)
    expect(body.status).toBe('failed')
    expect(body.outcome).toBe('policy_denied')
    expect(failureMessage(body)).toContain('SPEC_RENDER_DRIFT')
  })

  it('refuses a start whose declared spec id is not committed under specsRoot', async () => {
    const state = await root()
    const workspace = join(state, 'workspaces', 'session')
    await mkdir(workspace, { recursive: true })
    const canonicalWorkspace = await realpath(workspace)
    const one = '---\nid: REQ:forge/one\ntype: requirement\nstatus: draft\n---\n\n# One\n'
    const specsRoot = await specTree(join(state, '.specs'), { 'REQ-one.spec.md': one })
    const ctx = await mount(state, { specsRoot })
    const response = await start(ctx, canonicalWorkspace, 'forge-session-missing', preflight('<spec-bundle />\n', {
      specRefs: [{ id: 'REQ:forge/missing', digest: digest(one) }],
    }))
    const body = await startedBody(response)
    expect(body.status).toBe('failed')
    expect(body.outcome).toBe('unsupported')
    expect(failureMessage(body)).toContain('SPEC_UNRESOLVABLE')
  })

  it('refuses a start whose specsRoot declares one id in two committed files', async () => {
    const state = await root()
    const workspace = join(state, 'workspaces', 'session')
    await mkdir(workspace, { recursive: true })
    const canonicalWorkspace = await realpath(workspace)
    const spec = '---\nid: REQ:forge/duplicate\ntype: requirement\nstatus: draft\n---\n\n# Duplicate\n'
    const specsRoot = await specTree(join(state, '.specs'), {
      'first.spec.md': spec,
      'second.spec.md': spec,
    })
    const ctx = await mount(state, { specsRoot })
    const response = await start(ctx, canonicalWorkspace, 'forge-session-duplicate', preflight('<spec-bundle />\n', {
      specRefs: [{ id: 'REQ:forge/duplicate', digest: digest(spec) }],
    }))
    const body = await startedBody(response)
    expect(body.status).toBe('failed')
    expect(body.outcome).toBe('unsupported')
    expect(failureMessage(body)).toContain('SPEC_UNRESOLVABLE')
    expect(failureMessage(body)).toContain('declared by both')
  })

  it('refuses a preflight carrying specRefs when the adapter has no specsRoot configured', async () => {
    const state = await root()
    const workspace = join(state, 'workspaces', 'session')
    await mkdir(workspace, { recursive: true })
    const canonicalWorkspace = await realpath(workspace)
    const ctx = await mount(state)
    const response = await start(ctx, canonicalWorkspace, 'forge-session-noroot', preflight('<spec-bundle />\n', {
      specRefs: [{ id: 'REQ:forge/one', digest: digest('one') }],
    }))
    const body = await startedBody(response)
    expect(body.status).toBe('failed')
    expect(body.outcome).toBe('unsupported')
    expect(failureMessage(body)).toContain('SPECS_ROOT_REQUIRED')
    expect(failureMessage(body)).toContain('specsRoot')
  })

  it('refuses a preflight carrying repoRevision when neither repoRoot nor specsRoot is configured', async () => {
    const state = await root()
    const workspace = join(state, 'workspaces', 'session')
    await mkdir(workspace, { recursive: true })
    const canonicalWorkspace = await realpath(workspace)
    const ctx = await mount(state)
    const response = await start(ctx, canonicalWorkspace, 'forge-session-norepo', preflight('<spec-bundle />\n', {
      repoRevision: '0'.repeat(40),
    }))
    const body = await startedBody(response)
    expect(body.status).toBe('failed')
    expect(body.outcome).toBe('unsupported')
    expect(failureMessage(body)).toContain('REPO_ROOT_REQUIRED')
  })

  it('refuses a start whose checkout HEAD differs from the declared repoRevision', async () => {
    const state = await root()
    const workspace = join(state, 'workspaces', 'session')
    await mkdir(workspace, { recursive: true })
    const canonicalWorkspace = await realpath(workspace)
    const ctx = await mount(state, { repoRoot: repositoryRoot() })
    const response = await start(ctx, canonicalWorkspace, 'forge-session-mismatch', preflight('<spec-bundle />\n', {
      repoRevision: '0'.repeat(40),
    }))
    const body = await startedBody(response)
    expect(body.status).toBe('failed')
    expect(body.outcome).toBe('policy_denied')
    expect(failureMessage(body)).toContain('REPO_REVISION_MISMATCH')
  })

  it('refuses a start when git cannot report HEAD in the derived repo root', async () => {
    const state = await root()
    const workspace = join(state, 'workspaces', 'session')
    await mkdir(workspace, { recursive: true })
    const canonicalWorkspace = await realpath(workspace)
    const one = '---\nid: REQ:forge/one\ntype: requirement\nstatus: draft\n---\n\n# One\n'
    const specsRoot = await specTree(join(state, '.specs'), { 'REQ-one.spec.md': one })
    // A malformed gitfile marks the derived repo root so `git rev-parse HEAD` fails deterministically.
    await writeFile(join(state, '.git'), 'not a git directory\n')
    const ctx = await mount(state, { specsRoot })
    const response = await start(ctx, canonicalWorkspace, 'forge-session-nogit', preflight('<spec-bundle />\n', {
      specRefs: [{ id: 'REQ:forge/one', digest: digest(one) }],
      repoRevision: '0'.repeat(40),
    }))
    const body = await startedBody(response)
    expect(body.status).toBe('failed')
    expect(body.outcome).toBe('failed')
    expect(failureMessage(body)).toContain('REPO_REVISION_UNAVAILABLE')
  })
})
