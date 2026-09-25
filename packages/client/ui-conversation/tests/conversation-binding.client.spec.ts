import { afterEach, describe, expect, it, vi } from 'vitest'
import { MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { LlmAttemptId, MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { browserConversationScheduler } from '../src/client/conversation/browser-scheduler.ts'
import { ConversationNodeAssembler } from '../src/client/conversation/assembler.ts'
import { ConversationBindingModel, type ConversationScheduler } from '../src/client/conversation/binding.ts'
import type { ConversationNodeDefinition, ConversationViewDefinition } from '../src/client/contract/conversation.ts'

const definition: ConversationNodeDefinition<number> = {
  kind: 'counter', target: 'chat',
  match: event => event.type === 'turn/start'
    ? { id: String(event.data.turn), role: 'start' }
    : event.type === 'assistant/live-chunk' || event.type === 'assistant/attempt'
      ? { id: String(event.data.turn), role: 'update' } : null,
  start: () => 0,
  update: context => context.state + 1,
  publication: match => match.event.type === 'assistant/live-chunk' ? 'animation-frame' : 'immediate',
  buildViewNode: context => ({ key: context.key, id: context.id, kind: 'counter', target: 'chat', data: context.state }),
}
const view: ConversationViewDefinition = {
  target: 'chat',
  create() {
    const values = new Map<string, number>()
    return {
      empty: [],
      replace({ nodes }) { values.clear(); for (const node of nodes) values.set(node.key, Number(node.data)); return [...values.values()] },
      apply({ upserts }) { for (const node of upserts) values.set(node.key, Number(node.data)); return [...values.values()] },
    }
  },
}
function start(seq: number, turn = seq): SessionEventLikeEntry {
  return { type: 'event', event: { seq: SessionSeq(seq), time: seq, type: 'turn/start', data: { turn } } }
}
function chunk(seq: number): SessionEventLikeEntry {
  return { type: 'transient', event: { seq, time: seq, type: 'assistant/live-chunk', data: {
    attemptId: LlmAttemptId('attempt'), turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'x' },
  } } }
}
function create(scheduler: ConversationScheduler | null = null) {
  const feed = new MutableSessionEventSource()
  const assembler = new ConversationNodeAssembler(
    { entries: () => [definition], fallbackEntry: () => undefined }, { entries: () => [view] },
  )
  const binding = new ConversationBindingModel(feed, assembler, scheduler)
  return { feed, binding, target: binding.target('chat') }
}

describe('portable Conversation binding', () => {
  it('activates only when observed and detaches the feed on disposal', () => {
    const { feed, binding, target } = create()
    expect(target).toBe(binding.target('chat'))
    expect(target.getSnapshot()).toBeUndefined()
    const unsubscribe = target.subscribe(() => {})
    expect(target.getSnapshot()).toEqual([])
    feed.append(start(1))
    expect(target.getSnapshot()).toEqual([0])
    unsubscribe()
    binding.dispose()
    const snapshot = binding.snapshot.getSnapshot()
    feed.append(start(2))
    binding.activate('chat')
    binding.rebuild()
    expect(binding.snapshot.getSnapshot()).toBe(snapshot)
    expect(target.getSnapshot()).toEqual([0])
    binding.dispose()
  })
})

describe('Conversation event windows and scheduling', () => {
  it('publishes a mixed immediate and streaming batch immediately and ignores unmatched events', () => {
    const initial = new MutableSessionEventSource()
    let window = initial.getSnapshot()
    let invalidate = () => {}
    const callbacks: (() => void)[] = []
    const binding = new ConversationBindingModel({
      getSnapshot: () => window,
      subscribe(listener) { invalidate = listener; return () => {} },
    }, new ConversationNodeAssembler(
      { entries: () => [definition], fallbackEntry: () => undefined }, { entries: () => [view] },
    ), { schedule(publish) { callbacks.push(publish); return () => {} } })
    const target = binding.target('chat')
    const off = target.subscribe(() => {})
    try {
      const entries = [start(1), chunk(2), chunk(3)]
      window = { entries, hasMore: false, revision: 1, change: { kind: 'append', entries } }
      invalidate()
      expect(target.getSnapshot()).toEqual([2])
      expect(callbacks).toHaveLength(0)
      const snapshot = binding.snapshot.getSnapshot()
      const ignored: SessionEventLikeEntry = { type: 'event', event: {
        type: 'user/message', seq: SessionSeq(4), time: 4, surfaceOp: 'append',
        data: { id: MessageId('ignored'), role: 'user', content: [], source: { kind: 'user' } },
      } }
      window = { entries: [...entries, ignored], hasMore: false, revision: 2, change: { kind: 'append', entries: [ignored] } }
      invalidate()
      expect(binding.snapshot.getSnapshot()).toBe(snapshot)
    } finally { off(); binding.dispose() }
  })

  it('coalesces streaming updates and ignores a cancelled callback after immediate publication', () => {
    const callbacks: (() => void)[] = []
    let cancelled = 0
    const { feed, binding, target } = create({ schedule(publish) {
      callbacks.push(publish)
      return () => { cancelled++ }
    } })
    const off = target.subscribe(() => {})
    try {
      feed.append(start(1))
      feed.append(chunk(2))
      feed.append(chunk(3))
      expect(callbacks).toHaveLength(1)
      expect(target.getSnapshot()).toEqual([0])
      callbacks.at(0)?.()
      expect(target.getSnapshot()).toEqual([2])
      feed.append(chunk(4))
      feed.append(start(5))
      const snapshot = binding.snapshot.getSnapshot()
      expect(target.getSnapshot()).toEqual([3, 0])
      expect(cancelled).toBe(1)
      callbacks.at(1)?.()
      expect(binding.snapshot.getSnapshot()).toBe(snapshot)
    } finally { off(); binding.dispose() }
  })

  it('cancels pending streaming publication when the binding closes', () => {
    let publish = () => {}
    let cancelled = 0
    const { feed, binding, target } = create({ schedule(callback) { publish = callback; return () => { cancelled++ } } })
    const off = target.subscribe(() => {})
    feed.append(start(1))
    feed.append(chunk(2))
    binding.dispose()
    expect(cancelled).toBe(1)
    const snapshot = binding.snapshot.getSnapshot()
    publish()
    expect(target.getSnapshot()).toEqual([0])
    expect(binding.snapshot.getSnapshot()).toBe(snapshot)
    off()
  })

  it('applies prepend and replacement without retaining rows from the old baseline', () => {
    const { feed, binding, target } = create()
    const off = target.subscribe(() => {})
    try {
      feed.replace([start(2)], true)
      expect(target.getSnapshot()).toEqual([0])
      feed.prepend([start(1)], false)
      expect(target.getSnapshot()).toEqual([0, 0])
      feed.replace([start(9)], false)
      expect(target.getSnapshot()).toEqual([0])
    } finally { off(); binding.dispose() }
  })

  it('settles an Assistant attempt by removing its transient updates exactly once', () => {
    const { feed, binding, target } = create()
    const off = target.subscribe(() => {})
    try {
      feed.append(start(1))
      feed.append(chunk(2))
      feed.append(chunk(3))
      expect(target.getSnapshot()).toEqual([2])
      feed.settleAssistant(LlmAttemptId('attempt'), { type: 'event', event: {
        type: 'assistant/attempt', seq: SessionSeq(4), time: 4, data: { turn: 1, step: 1, stream: [] },
      } })
      expect(target.getSnapshot()).toEqual([1])
    } finally { off(); binding.dispose() }
  })

  it('replaces the complete window on a missed revision and ignores duplicate invalidation', () => {
    const feed = new MutableSessionEventSource()
    let invalidate = () => {}
    const assembler = new ConversationNodeAssembler(
      { entries: () => [definition], fallbackEntry: () => undefined }, { entries: () => [view] },
    )
    const binding = new ConversationBindingModel({
      getSnapshot: () => feed.getSnapshot(),
      subscribe(listener) { invalidate = listener; return () => {} },
    }, assembler, null)
    const target = binding.target('chat')
    let published = 0
    const off = target.subscribe(() => { published++ })
    try {
      feed.append(start(1))
      feed.append(start(2))
      invalidate()
      expect(target.getSnapshot()).toEqual([0, 0])
      const before = published
      invalidate()
      expect(published).toBe(before)
      binding.dispose()
      feed.append(start(3))
      invalidate()
      expect(published).toBe(before)
    } finally { off(); binding.dispose() }
  })

  it('rebuilds contributed Definitions and leaves source identity intact', () => {
    const feed = new MutableSessionEventSource()
    const definitions: ConversationNodeDefinition[] = []
    const assembler = new ConversationNodeAssembler(
      { entries: () => definitions, fallbackEntry: () => undefined }, { entries: () => [view] },
    )
    const binding = new ConversationBindingModel(feed, assembler, null)
    const target = binding.target('chat')
    const off = target.subscribe(() => {})
    try {
      feed.append(start(1))
      expect(target.getSnapshot()).toEqual([])
      definitions.push(definition)
      binding.rebuild()
      expect(target.getSnapshot()).toEqual([0])
      expect(binding.target('chat')).toBe(target)
    } finally { off(); binding.dispose() }
  })
})

afterEach(() => { vi.unstubAllGlobals() })

describe('browser Conversation scheduler', () => {
  it('selects immediate publication without an animation clock', () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    expect(browserConversationScheduler()).toBeNull()
  })

  it.each([true, false])('stops a cancelled callback before it can schedule another frame (cancel API %s)', (hasCancel) => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    const cancelled: number[] = []
    vi.stubGlobal('cancelAnimationFrame', hasCancel ? (frame: number) => cancelled.push(frame) : undefined)
    const scheduler = browserConversationScheduler()
    if (scheduler === null) throw new Error('expected browser scheduler')
    let published = 0
    const cancel = scheduler.schedule(() => { published++ })
    cancel()
    frames.at(0)?.(0)
    expect(frames).toHaveLength(1)
    expect(published).toBe(0)
    expect(cancelled).toEqual(hasCancel ? [1] : [])
  })
})
