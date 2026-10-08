import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionInfoService from '../src/service.ts'

const SESSION_ID = SessionId('session-info-1')
const OTHER_ID = SessionId('session-info-2')

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** One session projection cut with every key the service consumes. */
function projectionValues(withSummary = true): Record<string, unknown> {
  return {
    title: 'Fixture session',
    ...(withSummary ? { summary: 'Fixture summary' } : {}),
    agentPreset: 'default',
    modelSelection: {
      lastUsed: { provider: 'openrouter', model: 'vendor/model-x' },
      next: { provider: 'openrouter', model: 'vendor/model-x' },
    },
    sessionStats: { turns: 4, steps: 9 },
    permissions: {
      currentValue: 'workspace-write',
      canChange: false,
      options: [
        { value: 'workspace-write', name: 'Workspace Write', description: 'Write inside the workspace.' },
        { value: 'danger-full-access', name: 'Full access' },
      ],
      context: { environment: 'host', defaultPreset: 'workspace-write' },
    },
  }
}

interface HarnessOptions {
  readonly liveSession?: boolean
  readonly withPeers?: boolean
  readonly withSummary?: boolean
  /** Compose the execution providers and agent registry this reading observes. */
  readonly withEnvironment?: boolean
  /** Latest request-header fold the Session answers, or undefined before one lands. */
  readonly header?: unknown
  /** Derived model-visible messages the Session answers. */
  readonly messages?: readonly unknown[]
}

async function harness(options: HarnessOptions = {}): Promise<SessionInfoService> {
  const ctx = new Context()
  contexts.push(ctx)
  const session = {
    header: { id: SESSION_ID, cwd: '/work/fixture' },
    requestHeader: () => options.header,
    deriveMessages: () => options.messages ?? [],
  } as unknown as Session
  ctx.provide('sessions', {
    get: (id: string) => (options.liveSession === false ? undefined : id === SESSION_ID ? session : undefined),
  } as never)
  ctx.provide('sessionProjections', {
    snapshot: () => ({ asOfSeq: 0, values: projectionValues(options.withSummary !== false) }),
  } as never)
  if (options.withEnvironment !== false) {
    const world = Symbol.for('@deepseek-ai/dsh/host-execution-world')
    ctx.provide('fs', { executionWorld: world } as never)
    ctx.provide('subprocess', { executionWorld: world } as never)
    ctx.provide('agents', {
      get: (id: string) => id === SESSION_ID ? { ctx } : undefined,
      withInitiator: (_agent: unknown, run: () => unknown) => run(),
    } as never)
  }
  if (options.withPeers !== false) {
    ctx.provide('sandboxPolicy', {
      defaultMode: 'read-only',
      resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/work/fixture' }),
    } as never)
    ctx.provide('approval', {
      config: { policy: 'ask' },
      overrideOf: () => 'never',
    } as never)
    ctx.provide('workspaceRegistry', {
      list: () => [{
        id: 'ws-1',
        path: '/work/fixture',
        title: 'Fixture workspace',
        sessionIds: [SESSION_ID],
      }],
    } as never)
  }
  const fiber = await ctx.plugin(SessionInfoService)
  await fiber.await()
  return ctx.get('sessionInfo') as SessionInfoService
}

describe('SessionInfoService.read', () => {
  it('assembles session, workspace, environment, and policy facts from their owners', async () => {
    const service = await harness()
    const result = await service.read({ sessionId: SESSION_ID }, new AbortController().signal)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const value = result.value
    expect(value.session).toEqual({
      sessionId: SESSION_ID,
      title: 'Fixture session',
      agentPreset: 'default',
      model: { provider: 'openrouter', model: 'vendor/model-x' },
      cwd: '/work/fixture',
      turns: 4,
      steps: 9,
    })
    expect(value.summary).toBe('Fixture summary')
    expect(value.workspace).toEqual({ workspaceId: 'ws-1', path: '/work/fixture', title: 'Fixture workspace' })
    expect(value.environment.placement).toBe('host')
    expect(value.environment.environmentId).toMatch(/^host-[0-9a-f]{8}$/)
    expect(value.environment.platform).toBe(process.platform)
    expect(value.environment.arch).toBe(process.arch)
    expect(typeof value.environment.release).toBe('string')
    expect(value.environment.node).toBe(process.version)
    expect(typeof value.environment.home).toBe('string')
    expect(value.policies).toEqual({
      sandboxMode: 'workspace-write',
      sandboxDefault: 'read-only',
      workspaceRoot: '/work/fixture',
      approvalPolicy: 'never',
      approvalDefault: 'ask',
      permissionPreset: 'workspace-write',
      permissionPresetDescription: 'Write inside the workspace.',
      canChangePermission: false,
    })
    expect(typeof value.readAt).toBe('number')
  })

  it('reports an absent summary as an explicit null rather than a fabricated value', async () => {
    const service = await harness({ withSummary: false })
    const result = await service.read({ sessionId: SESSION_ID }, new AbortController().signal)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.summary).toBeNull()
  })

  it('degrades every absent optional owner to null instead of a fabricated value', async () => {
    const service = await harness({ withPeers: false })
    const result = await service.read({ sessionId: SESSION_ID }, new AbortController().signal)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.workspace).toBeNull()
    expect(result.value.policies).toEqual({
      sandboxMode: null,
      sandboxDefault: null,
      workspaceRoot: null,
      approvalPolicy: null,
      approvalDefault: null,
      permissionPreset: 'workspace-write',
      permissionPresetDescription: 'Write inside the workspace.',
      canChangePermission: false,
    })
    expect(result.value.environment.placement).toBe('host')
  })

  it('reports no environment identity when no execution world is observable', async () => {
    const service = await harness({ withEnvironment: false })
    const result = await service.read({ sessionId: SESSION_ID }, new AbortController().signal)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.environment.environmentId).toBeNull()
  })

  it('answers session-unavailable for a Session this Host does not hold', async () => {
    const service = await harness({ liveSession: false })
    await expect(service.read({ sessionId: OTHER_ID }, new AbortController().signal)).resolves.toEqual({
      ok: false,
      error: {
        reason: 'session-unavailable',
        detail: `session "${OTHER_ID}" is not live on this Host`,
      },
    })
  })

  it('answers session-unavailable for an already-aborted request without reading anything', async () => {
    const service = await harness()
    const controller = new AbortController()
    controller.abort()
    await expect(service.read({ sessionId: SESSION_ID }, controller.signal)).resolves.toEqual({
      ok: false,
      error: { reason: 'session-unavailable', detail: 'request aborted before the Session was read' },
    })
  })
})

/** One system-role message carrying rendered prompt text. */
function systemMessage(text: string): unknown {
  return { id: 'm-system', role: 'system', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'fixture' } }
}

/** One tool schema as a request header carries it. */
const TOOL = {
  name: 'bash',
  description: 'Run a shell command.',
  parameters: {
    type: 'object',
    properties: { command: { type: 'string', description: 'Command line.' } },
    required: ['command'],
  },
}
const OTHER_TOOL = { name: 'read', description: 'Read a file.', parameters: { type: 'object', properties: {} } }

describe('SessionInfoService.readPrompt', () => {
  it('reads the effective system prompt and the tool catalog from the Session log folds', async () => {
    const service = await harness({
      header: { config: { provider: 'openrouter', model: 'vendor/model-x' }, tools: [TOOL, OTHER_TOOL] },
      messages: [
        { id: 'm-user', role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } },
        systemMessage('You are a fixture agent.'),
      ],
    })
    const result = await service.readPrompt({ sessionId: SESSION_ID }, new AbortController().signal)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.systemPrompt).toBe('You are a fixture agent.')
    expect(result.value.tools).toEqual([TOOL, OTHER_TOOL])
    expect(result.value.model).toEqual({ provider: 'openrouter', model: 'vendor/model-x' })
    expect(typeof result.value.readAt).toBe('number')
  })

  it('takes the last system node as the effective prompt and joins its text blocks', async () => {
    const service = await harness({
      messages: [
        systemMessage('First instructions.'),
        systemMessage('Second instructions.'),
        { id: 'm-update', role: 'system', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], source: { kind: 'plugin', plugin: 'fixture' } },
      ],
    })
    const result = await service.readPrompt({ sessionId: SESSION_ID }, new AbortController().signal)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.systemPrompt).toBe('a\nb')
  })

  it('renders a non-text system block through its JSON form', async () => {
    const service = await harness({
      messages: [{ id: 'm-json', role: 'system', content: [{ type: 'custom-block', value: 1 }], source: { kind: 'plugin', plugin: 'fixture' } }],
    })
    const result = await service.readPrompt({ sessionId: SESSION_ID }, new AbortController().signal)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.systemPrompt).toBe('{"type":"custom-block","value":1}')
  })

  it('reports an explicit empty prompt and catalog before the first request', async () => {
    const service = await harness()
    const result = await service.readPrompt({ sessionId: SESSION_ID }, new AbortController().signal)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({ systemPrompt: '', tools: [], model: null })
  })

  it('omits tools and the model route when the header carries none', async () => {
    const service = await harness({ header: { config: { provider: 'openrouter', model: 'vendor/model-x' } }, messages: [systemMessage('Prompt.')] })
    const result = await service.readPrompt({ sessionId: SESSION_ID }, new AbortController().signal)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.tools).toEqual([])
    expect(result.value.model).toEqual({ provider: 'openrouter', model: 'vendor/model-x' })
  })

  it('answers session-unavailable for a Session this Host does not hold', async () => {
    const service = await harness({ liveSession: false })
    await expect(service.readPrompt({ sessionId: OTHER_ID }, new AbortController().signal)).resolves.toEqual({
      ok: false,
      error: {
        reason: 'session-unavailable',
        detail: `session "${OTHER_ID}" is not live on this Host`,
      },
    })
  })

  it('answers session-unavailable for an already-aborted request without reading anything', async () => {
    const service = await harness()
    const controller = new AbortController()
    controller.abort()
    await expect(service.readPrompt({ sessionId: SESSION_ID }, controller.signal)).resolves.toEqual({
      ok: false,
      error: { reason: 'session-unavailable', detail: 'request aborted before the Session was read' },
    })
  })
})
