import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { requiresSessionAdmission, type SessionAdmission, type SessionCompositionSource } from '@deepseek-ai/dsh-agent-presets'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-skill'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionSkillCatalog } from '../src/skill-catalog.ts'

function observation(
  sessionId: SessionId,
  options: { readonly cwd?: string; readonly agentPreset?: string; readonly events?: readonly SessionEvent[] } = {},
): SessionObservation {
  const events = Object.freeze(options.events ?? [])
  const lease = (): SessionObservation => ({
    source: 'live',
    header: {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 1,
      isSeeded: false,
      ...options.cwd === undefined ? {} : { cwd: options.cwd },
      ...options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset },
    },
    events,
    inheritedEventCount: SessionLogOffset(0),
    cursor: -1,
    projections: {
      asOfSeq: -1,
      values: {
        ...options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset },
      },
    },
    retain: lease,
    [Symbol.dispose]: () => {},
  })
  return lease()
}

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

async function context(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  return ctx
}

describe('SessionSkillCatalog', () => {
  it('reads a cold Session catalog without resuming an Agent', async () => {
    const ctx = await context()
    const sessionId = SessionId('cold-skills')
    const observed = observation(sessionId, { cwd: '/cold/project' })
    const dispose = vi.spyOn(observed, Symbol.dispose)
    const observeSession = vi.fn(() => Promise.resolve(observed))
    ctx.provide('sessionQuery', { observeSession } as never)
    const resume = vi.spyOn(ctx.agents, 'resume')
    const list = vi.fn(() => Promise.resolve([
      {
        name: 'review',
        description: 'Review the current change.',
        whenToUse: 'Before publishing.',
        invocation: { modelInvocable: true, userInvocable: true },
      },
      {
        name: 'model-only',
        description: 'Not shown to the user.',
        invocation: { modelInvocable: true, userInvocable: false },
      },
    ]))
    ctx.provide('skills', { list } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal)).resolves.toEqual({
      skills: [{
        name: 'review',
        description: 'Review the current change.',
        whenToUse: 'Before publishing.',
        modelInvocable: true,
      }],
    })
    expect(observeSession).toHaveBeenCalledWith(sessionId)
    expect(dispose).toHaveBeenCalledOnce()
    expect(resume).not.toHaveBeenCalled()
    expect(ctx.agents.list()).toEqual([])
    expect(list).toHaveBeenCalledWith({ cwd: '/cold/project', scope: undefined })
  })

  it('uses a live Agent to address a preset-owned registry', async () => {
    const ctx = await context()
    const sessionId = SessionId('live-skills')
    const session = ctx.sessions.create(sessionId, { meta: { cwd: '/live/project' } })
    const agent = { id: sessionId, session, status: 'idle', ctx } as Agent
    ctx.agents.register(agent)
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, { cwd: '/live/project' })),
    } as never)
    const scopedList = vi.fn(() => Promise.resolve([{
      name: 'preset-owned',
      description: 'Composed for this Agent.',
      invocation: { modelInvocable: false, userInvocable: true },
    }]))
    const standingKeyFor = vi.fn()
    ctx.provide('agentPresets', {
      serviceFor: () => ({ list: scopedList }),
      standingKeyFor,
    } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal)).resolves.toEqual({
      skills: [{
        name: 'preset-owned',
        description: 'Composed for this Agent.',
        modelInvocable: false,
      }],
    })
    expect(scopedList).toHaveBeenCalledWith({ cwd: '/live/project', scope: agent })
    expect(standingKeyFor).not.toHaveBeenCalled()
  })

  it('uses the recorded preset standing scope for a cold Session', async () => {
    const ctx = await context()
    const sessionId = SessionId('standing-skills')
    const scope = { agentPreset: 'minimal' }
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, {
        cwd: '/cold/project',
        agentPreset: 'minimal',
      })),
    } as never)
    const standingKeyForSession = vi.fn((_source: SessionCompositionSource) => Promise.resolve(scope))
    ctx.provide('agentPresets', { standingKeyForSession, requiresSessionAdmission: () => false } as never)
    const list = vi.fn(() => Promise.resolve([]))
    ctx.provide('skills', { list } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal)).resolves.toEqual({ skills: [] })
    expect(standingKeyForSession).toHaveBeenCalledOnce()
    expect(standingKeyForSession.mock.calls[0]?.[0]).toMatchObject({
      header: { id: sessionId, cwd: '/cold/project', agentPreset: 'minimal' },
      inheritedEventCount: SessionLogOffset(0), events: [],
    })
    expect(list).toHaveBeenCalledWith({ cwd: '/cold/project', scope })
    expect(ctx.agents.list()).toEqual([])
  })

  it('falls back to the global registry when the recorded preset is unavailable', async () => {
    const ctx = await context()
    const sessionId = SessionId('gone-preset')
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, {
        cwd: '/cold/project',
        agentPreset: 'gone',
      })),
    } as never)
    ctx.provide('agentPresets', {
      standingKeyForSession: () => Promise.reject(new Error('unknown preset')),
      requiresSessionAdmission: () => false,
    } as never)
    const list = vi.fn(() => Promise.resolve([]))
    ctx.provide('skills', { list } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal)).resolves.toEqual({ skills: [] })
    expect(list).toHaveBeenCalledWith({ cwd: '/cold/project', scope: undefined })
  })

  it('rejects a failed configured admission without listing global skills or creating an Agent', async () => {
    const ctx = await context()
    const sessionId = SessionId('invalid-admitted-skills')
    const observed = observation(sessionId, { cwd: '/host/project', agentPreset: 'standard' })
    const dispose = vi.spyOn(observed, Symbol.dispose)
    ctx.provide('sessionQuery', { observeSession: () => Promise.resolve(observed) } as never)
    const requiresSessionAdmission = vi.fn(() => true)
    ctx.provide('agentPresets', {
      standingKeyForSession: () => Promise.reject(new Error('prefix digest mismatch')),
      requiresSessionAdmission,
    } as never)
    const list = vi.fn(() => Promise.resolve([]))
    ctx.provide('skills', { list } as never)
    const resume = vi.spyOn(ctx.agents, 'resume')
    const catalog = new SessionSkillCatalog(ctx)

    const rejected = catalog.list({ sessionId }, new AbortController().signal)
    await expect(rejected).rejects.toMatchObject({ code: 'gateway/internal' })
    await expect(rejected).rejects.toThrow('admission could not be validated')
    expect(requiresSessionAdmission).toHaveBeenCalledWith(observed)
    expect(list).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
    expect(ctx.agents.list()).toEqual([])
  })

  it('rejects an unlisted recorded host before global registry lookup or skill listing', async () => {
    const ctx = await context()
    const sessionId = SessionId('host-descendant-skills')
    const observed = observation(sessionId, { cwd: '/host/project', agentPreset: 'standard', events: [
      { type: 'permission/context', seq: SessionSeq(0), time: 1,
        data: { environment: 'host', defaultPreset: 'original-policy' } },
    ] })
    const dispose = vi.spyOn(observed, Symbol.dispose)
    ctx.provide('sessionQuery', { observeSession: () => Promise.resolve(observed) } as never)
    const entry = { sessionId: SessionId('ancestor'), agentPreset: 'standard', compositionPreset: 'host-wrapper' } as SessionAdmission
    const admissions = new Map([[entry.sessionId, entry]])
    const requires = vi.fn((source: SessionObservation) => requiresSessionAdmission(source, admissions))
    ctx.provide('agentPresets', {
      standingKeyForSession: () => Promise.reject(new Error('own session admission required')),
      requiresSessionAdmission: requires,
    } as never)
    const list = vi.fn(() => Promise.resolve([]))
    const registry = vi.spyOn(ctx, 'get')
    ctx.provide('skills', { list } as never)
    const resume = vi.spyOn(ctx.agents, 'resume')
    await expect(new SessionSkillCatalog(ctx).list({ sessionId }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'gateway/internal' })
    expect(requires).toHaveBeenCalledWith(observed)
    expect(list).not.toHaveBeenCalled()
    expect(registry).not.toHaveBeenCalledWith('skills')
    expect(resume).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it.each([
    {
      error: new SessionQueryError(
        'session "missing-skills" not found',
        'SESSION_QUERY_SESSION_NOT_FOUND',
      ),
      code: 'session/not-found',
    },
    { error: new Error('storage offline'), code: 'gateway/internal' },
  ] as const)('classifies failed Session inspection as $code', async ({ error, code }) => {
    const ctx = await context()
    ctx.provide('sessionQuery', { observeSession: () => Promise.reject(error) } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list(
      { sessionId: SessionId('missing-skills') },
      new AbortController().signal,
    )).rejects.toMatchObject({ code })
  })

  it('reports an absent skill registry instead of an empty catalog', async () => {
    const ctx = await context()
    const sessionId = SessionId('no-skills')
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, { cwd: '/project' })),
    } as never)
    const catalog = new SessionSkillCatalog(ctx)

    const failed = catalog.list({ sessionId }, new AbortController().signal)
    await expect(failed).rejects.toMatchObject({ code: 'gateway/internal' })
    await expect(failed).rejects.toThrow('skill registry is absent')
  })

  it('rejects observations without projections or a project cwd', async () => {
    const ctx = await context()
    const sessionId = SessionId('incomplete-skills')
    const withoutProjections = { ...observation(sessionId, { cwd: '/project' }), projections: undefined }
    const observeSession = vi.fn()
      .mockResolvedValueOnce(withoutProjections)
      .mockResolvedValueOnce(observation(sessionId))
    ctx.provide('sessionQuery', { observeSession } as never)
    const catalog = new SessionSkillCatalog(ctx)

    const unprojected = catalog.list({ sessionId }, new AbortController().signal)
    await expect(unprojected).rejects.toMatchObject({ code: 'gateway/internal' })
    await expect(unprojected).rejects.toThrow('projected Session observation')
    const cwdless = catalog.list({ sessionId }, new AbortController().signal)
    await expect(cwdless).rejects.toMatchObject({ code: 'gateway/internal' })
    await expect(cwdless).rejects.toThrow('has no project cwd')
  })

  it('classifies a provider listing failure', async () => {
    const ctx = await context()
    const sessionId = SessionId('failed-skills')
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, { cwd: '/project' })),
    } as never)
    ctx.provide('skills', {
      list: () => Promise.reject(new Error('catalog offline')),
    } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal))
      .rejects.toMatchObject({
        code: 'gateway/internal', message: 'skill listing failed: Error: catalog offline',
      })
  })
})
