/** Compiled Session-to-Chat retained-memory measurement with a deterministic external Remote. */
import { strict as assert } from 'node:assert'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionEventEntry, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ChatConversationViewNode, ChatNode } from '../../packages/client/ui-chat/src/client/contract/chat-nodes.ts'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
// Private integration adapters are bundled; their workspace imports resolve built libraries.
import { HistoryDetailRetention } from '../../packages/api/session-controller/src/client/history-detail-retention.ts'
import { Session } from '../../packages/api/session-controller/src/client/sessions/session.ts'
import { FakeApiClient, fakeRemote, ok } from '../../packages/api/session-controller/tests/fake-api.client.ts'
import { ConversationNodeAssembler } from '../../packages/client/ui-conversation/src/client/conversation/assembler.ts'
import { BenchEventDefinitions, BenchViewDefinitions } from './chat-definitions.client.ts'
import { assertBuiltBenchmarkRuntime } from '../support/built-worker.ts'

/** Retained-memory sample after Session and Chat projection reach the same accepted window. */
export interface HistoryDetailWorkerReport {
  readonly workload: 'typical' | 'tail'
  readonly bounded: boolean
  readonly maxSerializedChars: number
  readonly events: number
  readonly reads: number
  readonly chatNodes: number
  readonly retainedDetails: number
  readonly serializedChars: number
  readonly beforeHeap: number
  readonly afterHeap: number
  readonly retainedHeap: number
}

const EVENTS = 10_000
const PAGE = 250
const TIME_ZERO = 1_700_000_000_000
const platform = { createRequestId: () => 'unused' as SessionRequestId, timeZone: () => 'UTC' }

function event(seq: number, type: string, data: unknown, append = false): SessionEventEntry {
  return { type: 'event', event: { seq, time: TIME_ZERO + seq, type, data, ...(append ? { surfaceOp: 'append' } : {}) } } as SessionEventEntry
}

function result(seq: number, body: string, compact = false): SessionEventEntry {
  const value = event(seq, 'tool/result', {
    turn: Math.floor(seq / 10) + 1, step: 1,
    message: { id: `result-${String(seq)}`, role: 'user',
      source: { kind: 'tool', callId: `call-${String(seq - 1)}` },
      content: [{ type: 'tool-result', toolCallId: `call-${String(seq - 1)}`, isError: false, content: [{ type: 'text', text: body }] }],
    },
  }, true)
  return compact ? { ...value, detail: { kind: 'tool-result', bytes: 2_000_000 } } : value
}

function history(): SessionEventEntry[] {
  const entries: SessionEventEntry[] = []
  for (let seq = 0; seq < EVENTS; seq += 10) {
    const turn = seq / 10 + 1
    entries.push(
      event(seq, 'turn/start', { turn }),
      event(seq + 1, 'user/message', { id: `user-${String(turn)}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `prompt ${String(turn)}` }] }, true),
      event(seq + 2, 'step/start', { turn, step: 1 }),
      event(seq + 3, 'tool/call', { turn, step: 1, callId: `call-${String(seq + 3)}`, name: 'read', arguments: '{}' }),
      result(seq + 4, '', true),
      event(seq + 5, 'tool/call', { turn, step: 1, callId: `call-${String(seq + 5)}`, name: 'read', arguments: '{}' }),
      result(seq + 6, '', true),
      event(seq + 7, 'assistant/message', { turn, step: 1, stream: [], message: { id: `assistant-${String(turn)}`, role: 'assistant', source: { kind: 'model', provider: 'bench', model: 'bench' }, content: [{ type: 'text', text: 'done' }] } }, true),
      event(seq + 8, 'step/end', { turn, step: 1 }),
      event(seq + 9, 'turn/end', { turn, reason: { kind: 'completed' } }),
    )
  }
  return entries
}

function collectHeap(): number {
  assert(globalThis.gc, 'worker needs --expose-gc')
  for (let pass = 0; pass < 3; pass += 1) globalThis.gc()
  return process.memoryUsage().heapUsed
}

assertBuiltBenchmarkRuntime(import.meta.url, {
  '@deepseek-ai/dsh-client-store': import.meta.resolve('@deepseek-ai/dsh-client-store'),
  '@deepseek-ai/dsh-api-gateway/client/portable': import.meta.resolve('@deepseek-ai/dsh-api-gateway/client/portable'),
  '@deepseek-ai/dsh-session/types': import.meta.resolve('@deepseek-ai/dsh-session/types'),
})
const workload = process.argv[2]
assert(workload === 'typical' || workload === 'tail')
const count = workload === 'typical' ? 16 : 64
const chars = workload === 'typical' ? 65_536 : 1_048_576
const bounded = process.argv[3] !== 'unbounded'
const maxSerializedChars = 8 * 1024 * 1024
const api = new FakeApiClient()
const compact = history()
api.onHistory = async ({ beforeSeq = EVENTS }) => ok({ records: compact.slice(Math.max(0, beforeSeq - PAGE), beforeSeq), hasMore: beforeSeq > PAGE })
api.onHistoryDetail = async ({ seq }) => {
  // Parsing produces independent flat payloads; neither a shared backing string nor a fake cache owns them.
  const value = result(seq, `${String(seq).padStart(8, '0')}${'x'.repeat(chars - 8)}`)
  return ok(JSON.parse(JSON.stringify(value)) as SessionEventEntry)
}
const session = new Session('bench-history' as SessionId, fakeRemote(api), platform, bounded ? { historyDetailRetention: new HistoryDetailRetention({ maxSerializedChars }) } : {})
const assembler = new ConversationNodeAssembler(new BenchEventDefinitions(), new BenchViewDefinitions())
assembler.activateTarget('chat')
const update = (): void => {
  const window = session.eventSource.getSnapshot()
  assembler.replaceWindow(window.entries, window.hasMore)
  assembler.activateTarget('chat')
  assembler.flush()
}
const unsubscribe = session.eventSource.subscribe(update)
const releaseRows: (() => void)[] = []
const rendered = new Map<string, ChatConversationViewNode | undefined>()
try {
  await session.open()
  while (session.getSnapshot().hasMore) await session.loadOlder()
  const initial = assembler.snapshot('chat') as ChatSnapshot
  for (const key of initial.order) {
    const source = initial.nodes.source(key)
    rendered.set(key, source.getSnapshot())
    releaseRows.push(source.subscribe(() => { rendered.set(key, source.getSnapshot()) }))
  }
  const before = collectHeap()
  for (let index = 0; index < count; index += 1) await session.loadHistoryDetail(index * 10 + 4)
  const after = collectHeap()
  const window = session.eventSource.getSnapshot()
  const snapshot = assembler.snapshot('chat') as ChatSnapshot
  assert.equal(window.entries.length, EVENTS)
  assert.equal(window.hasMore, false)
  assert.equal(snapshot.order.length, 6000)
  for (const node of snapshot.nodes.values()) assert.equal(rendered.get(node.key), node)
  assert.deepEqual(window.entries.map(entry => entry.event.seq), Array.from({ length: EVENTS }, (_, seq) => seq))
  const retained = window.entries.filter(entry => entry.event.type === 'tool/result' && entry.type === 'event' && entry.detail === undefined)
  assert.equal(retained.length, bounded && workload === 'tail' ? 7 : count)
  const projected = snapshot.nodes.values().filter(node => node.kind === 'tool-call').map(node => (node as ChatNode<'tool-call'>).data.root)
  const fullResults = projected.filter(root => 'kind' in root && root.kind === 'tool-result' && root.deferred !== true)
  assert.equal(projected.length, 2000)
  assert.equal(fullResults.length, retained.length)
  for (const root of fullResults) {
    assert('kind' in root && root.kind === 'tool-result')
    if (!('kind' in root) || root.kind !== 'tool-result') continue
    assert.equal(root.content.length, 1)
    const block = root.content[0]
    assert.equal(block?.type, 'text')
    if (block?.type === 'text') {
      assert.equal(block.text.length, chars)
      assert.equal(block.text.slice(0, 8), String(root.seq).padStart(8, '0'))
    }
  }
  console.log(JSON.stringify({ workload, bounded, maxSerializedChars, events: window.entries.length, reads: api.callsOf('session.historyDetail').length,
    chatNodes: snapshot.order.length, subscribedRows: rendered.size, retainedDetails: retained.length, serializedChars: retained.reduce((n, entry) => n + JSON.stringify(entry).length, 0),
    beforeHeap: before, afterHeap: after, retainedHeap: after - before, pid: process.pid }))
} finally {
  for (const release of releaseRows) release()
  unsubscribe()
  await session.dispose()
}
