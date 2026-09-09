import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import MemoryRuntime, { MemoryId } from '@deepseek-ai/dsh-memory'
import type { MemoryProvider, MemoryProposal, MemoryRecord } from '@deepseek-ai/dsh-memory'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as Extractor from '../src/index.ts'

function unused(): Promise<never> { return Promise.reject(new Error('unused')) }

describe('memory extractor lifecycle', () => {
  it('flushes the turn, logs before dispatch, and settles an extracted proposal', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemoryRuntime)
    const proposals: MemoryProposal[] = []
    const provider: MemoryProvider = {
      id: 'test', query: unused, get: unused, challenge: unused, review: unused,
      supersede: unused, checkpoint: unused, delete: unused,
      propose(request) {
        proposals.push(request)
        const now = Date.now()
        return Promise.resolve({
          id: MemoryId('mem-1'), revision: 1, scope: request.scope, statement: request.statement,
          status: 'proposed', evidence: request.evidence, trust: request.trust,
          validity: request.validity ?? {}, contradicts: request.contradicts ?? [],
          createdAt: now, updatedAt: now, lastAccessedAt: now, accessCount: 0,
        } satisfies MemoryRecord)
      },
    }
    ctx.memory.registerProvider(provider)
    const session = ctx.sessions.create(SessionId('extract'), { meta: { cwd: '/repo' } })
    class Adapter extends LlmAdapter {
      async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        expect(session.snapshotEvents().some(event => event.type === 'memory/extraction-request')).toBe(true)
        yield { type: 'text-delta', index: 0, text: '{"proposals":[{"statement":"Uses pnpm","trust":0.8}]}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    ctx.llm.registerAdapter(['extractor'], new Adapter())
    await ctx.plugin(Extractor, {
      provider: 'extractor', model: 'test', maxInputBytes: 10_000, maxOutputTokens: 500,
      timeoutMs: 1_000, maxQueue: 2, concurrency: 1, maxProposals: 2,
    })
    const settled = new Promise<void>((resolve) => {
      const dispose = ctx.on('session/event', (_subject, event) => {
        if (event.type !== 'memory/extraction-result') return
        dispose()
        resolve()
      })
    })
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await settled

    expect(proposals).toHaveLength(1)
    expect(proposals[0]).toMatchObject({
      scope: { kind: 'project', project: '/repo' },
      statement: 'Uses pnpm',
      trust: { score: 0.8, source: 'extracted' },
      evidence: [{ kind: 'session', ref: 'extract:turn:1' }],
    })
    expect(session.snapshotEvents().map(event => event.type)).toEqual([
      'turn/start', 'turn/end', 'memory/extraction-request', 'memory/extraction-result',
    ])
  })

  it('records provider failure without changing the completed parent turn', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemoryRuntime)
    class FailingAdapter extends LlmAdapter {
      async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        throw new Error('extractor unavailable')
      }
    }
    ctx.llm.registerAdapter(['extractor'], new FailingAdapter())
    await ctx.plugin(Extractor, {
      provider: 'extractor', model: 'test', maxInputBytes: 10_000, maxOutputTokens: 500,
      timeoutMs: 1_000, maxQueue: 2, concurrency: 1, maxProposals: 2,
    })
    const session = ctx.sessions.create(SessionId('extract-failure'), { meta: { cwd: '/repo' } })
    const settled = new Promise<void>((resolve) => {
      const dispose = ctx.on('session/event', (_subject, event) => {
        if (event.type !== 'memory/extraction-result') return
        dispose()
        resolve()
      })
    })

    session.append('turn/start', { turn: 1 })
    expect(() => session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })).not.toThrow()
    await settled

    expect(session.snapshotEvents().find(event => event.type === 'turn/end')).toMatchObject({ data: { reason: { kind: 'completed' } } })
    expect(session.snapshotEvents().find(event => event.type === 'memory/extraction-result')).toMatchObject({
      data: { proposedIds: [], failure: { code: 'provider-error' } },
    })
  })
})
