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
}

async function harness(options: HarnessOptions = {}): Promise<SessionInfoService> {
  const ctx = new Context()
  contexts.push(ctx)
  const session = {
    header: { id: SESSION_ID, cwd: '/work/fixture' },
  } as unknown as Session
  ctx.provide('sessions', {
    get: (id: string) => (options.liveSession === false ? undefined : id === SESSION_ID ? session : undefined),
  } as never)
  ctx.provide('sessionProjections', {
    snapshot: () => ({ asOfSeq: 0, values: projectionValues(options.withSummary !== false) }),
  } as never)
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
