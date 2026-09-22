/** Host-wide exact-detail retention, eviction and Session lifetime. */
import { describe, expect, it, vi } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { browserSessionPlatform } from '../src/client/browser.ts'
import { HistoryDetailLimitError, HistoryDetailRetention } from '../src/client/history-detail-retention.ts'
import { SessionManager } from '../src/client/sessions/manager.ts'
import { FakeApiClient, fakeRemote, ok } from './fake-api.client.ts'
import { entries, ev } from './event-script.client.ts'

const s1 = 'retained-a' as SessionId
const s2 = 'retained-b' as SessionId
const exact = (seq: number, text: string) => entries([ev.toolResult(SessionSeq(seq), 0, `call-${String(seq)}`, text)])[0]!
const a = exact(0, 'A'.repeat(256))
const b = exact(1, 'B'.repeat(256))
const compact = [0, 1].map(seq => ({ ...exact(seq, ''), detail: { kind: 'tool-result' as const, bytes: 9999 } }))
const size = Math.max(JSON.stringify(a).length, JSON.stringify(b).length)

function fixture(limit = size) {
  const api = new FakeApiClient()
  api.onHistory = async () => ok({ records: compact, hasMore: false })
  api.onHistoryDetail = async ({ seq }) => ok(seq === 0 ? a : b)
  const manager = new SessionManager(fakeRemote(api), browserSessionPlatform, undefined, undefined, { maxSerializedChars: limit })
  return { api, manager, first: manager.get(s1), second: manager.get(s2) }
}

it('accepts the exact budget, releases idempotently and rejects invalid composition limits', () => {
  for (const maxSerializedChars of [0, -1, 1.5, Infinity, NaN]) {
    expect(() => new HistoryDetailRetention({ maxSerializedChars })).toThrow('positive safe integer')
  }
  const pool = new HistoryDetailRetention({ maxSerializedChars: 10 })
  const evict = vi.fn()
  const release = pool.retain(10, evict)
  release(); release()
  pool.retain(10, evict)
  expect(evict).not.toHaveBeenCalled()
  expect(() => pool.retain(11, evict)).toThrow(HistoryDetailLimitError)
  expect(evict).not.toHaveBeenCalled()
})

describe('resident Session detail budget', () => {
  it('evicts across Sessions, preserves compact entry identity and permits an explicit reload', async () => {
    const { api, manager, first, second } = fixture()
    try {
      await Promise.all([first.open(), second.open()])
      await first.loadHistoryDetail(0)
      expect(first.eventSource.getSnapshot().entries[0]).toBe(a)
      await second.loadHistoryDetail(1)
      expect(first.eventSource.getSnapshot().entries[0]).toBe(compact[0])
      expect(second.eventSource.getSnapshot().entries[1]).toBe(b)
      expect(first.eventSource.getSnapshot().entries.map(entry => entry.event.seq)).toEqual([0, 1])
      expect(first.getSnapshot()).toMatchObject({ hasMore: false, openState: 'open' })
      expect(api.callsOf('session.historyDetail')).toHaveLength(2)
      await first.loadHistoryDetail(0)
      expect(second.eventSource.getSnapshot().entries[1]).toBe(compact[1])
      expect(first.eventSource.getSnapshot().entries[0]).toBe(a)
      expect(api.callsOf('session.historyDetail')).toHaveLength(3)
    } finally { await manager.dispose() }
  })

  it('does not restore a locally evicted hydration from a stale pre-eviction window', async () => {
    const { manager, first } = fixture()
    try {
      await first.open()
      await first.loadHistoryDetail(0)
      await first.loadHistoryDetail(1)
      expect(first.eventSource.getSnapshot().entries).toEqual([compact[0], b])
    } finally { await manager.dispose() }
  })

  it('leaves accepted entries and compact metadata intact when a complete entry is too large', async () => {
    const { api, manager, first, second } = fixture()
    try {
      await Promise.all([first.open(), second.open()])
      await first.loadHistoryDetail(0)
      const oversized = exact(1, '😀'.repeat(size))
      api.onHistoryDetail = async () => ok(oversized)
      await expect(second.loadHistoryDetail(1)).rejects.toMatchObject({ name: 'HistoryDetailLimitError', serializedChars: JSON.stringify(oversized).length, maxSerializedChars: size })
      expect(first.eventSource.getSnapshot().entries[0]).toBe(a)
      expect(second.eventSource.getSnapshot().entries[1]).toBe(compact[1])
      api.onHistoryDetail = async () => ok(b)
      await second.loadHistoryDetail(1)
      expect(second.eventSource.getSnapshot().entries[1]).toBe(b)
    } finally { await manager.dispose() }
  })

  it.each(['resync', 'dispose'] as const)('releases hydrated data on %s without retaining its charge', async (operation) => {
    const { manager, first, second } = fixture(size * 2)
    try {
      await Promise.all([first.open(), second.open()])
      await first.loadHistoryDetail(0)
      await first[operation]()
      expect(first.eventSource.getSnapshot().entries[0]).toBe(compact[0])
      await second.loadHistoryDetail(0)
      await second.loadHistoryDetail(1)
      expect(second.eventSource.getSnapshot().entries).toEqual([a, b])
    } finally { await manager.dispose() }
  })

  it('does not publish a hydration if eviction observers replace its Session generation', async () => {
    const { manager, first, second } = fixture()
    let replacement: Promise<void> | undefined
    let unsubscribe = () => {}
    try {
      await Promise.all([first.open(), second.open()])
      await first.loadHistoryDetail(0)
      unsubscribe = first.eventSource.subscribe(() => { replacement = second.resync() })
      await second.loadHistoryDetail(1)
      unsubscribe()
      await replacement
      expect(second.eventSource.getSnapshot().entries).toEqual(compact)
      await second.loadHistoryDetail(0)
      expect(second.eventSource.getSnapshot().entries[0]).toBe(a)
    } finally { unsubscribe(); await replacement; await manager.dispose() }
  })
})
