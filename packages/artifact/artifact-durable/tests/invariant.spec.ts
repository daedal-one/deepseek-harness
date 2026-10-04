/** Live publication events and independently observed durable manifest receipts. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import Invariants from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import * as Companion from '../src/invariant.ts'
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})
async function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Invariants)
  const revision = { revisionId: 'revision', sessionId: 'publisher', title: 'Captured' }
  let receipt: unknown = { revisionId: 'revision', sessionId: 'publisher', abandoned: false, revision }
  const close = vi.fn(async () => {})
  ctx.provide('artifacts', {} as never)
  ctx.provide('storageDomain', {
    open: async () => ({ global: { get: () => ({ operations: receipt === null ? [] : [receipt] }) }, close }),
  } as never)
  await ctx.plugin(Companion)
  const emit = (value: unknown = revision, sessionId = 'publisher') => {
    ctx.emit(
      'session/event',
      { id: sessionId } as Session,
      { type: 'artifact/published', data: { revision: value } } as SessionEvent,
    )
  }
  return {
    ctx,
    emit,
    close,
    receipt: (value: unknown) => {
      receipt = value
    },
    revision,
  }
}
it('accepts an exact receipt, ignores other Session events and releases its ledger reader', async () => {
  const h = await harness()
  expect(() => {
    h.emit()
  }).not.toThrow()
  expect(() => {
    h.ctx.emit('session/event', {} as Session, { type: 'turn/start' } as SessionEvent)
  }).not.toThrow()
  await h.ctx.fiber.dispose()
  expect(h.close).toHaveBeenCalledOnce()
})
it.each(['missing', 'abandoned', 'uncaptured', 'creator', 'manifest'])(
  'reports a %s receipt relationship',
  async (kind) => {
    const h = await harness()
    if (kind === 'missing') h.receipt(null)
    if (kind === 'abandoned')
      h.receipt({ revisionId: 'revision', sessionId: 'publisher', abandoned: true, revision: h.revision })
    if (kind === 'uncaptured')
      h.receipt({ revisionId: 'revision', sessionId: 'publisher', abandoned: false, revision: null })
    expect(() => {
      h.emit(
        kind === 'manifest' ? { ...h.revision, title: 'Replaced' } : h.revision,
        kind === 'creator' ? 'other' : 'publisher',
      )
    }).toThrow('invariant violated by "@deepseek-ai/dsh-artifact-durable"')
  },
)
