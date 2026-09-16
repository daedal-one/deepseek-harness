import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LlmAttemptId, MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  ConversationBindingModel, ConversationNodeAssembler, ConversationEventRegistry, ConversationViewRegistry,
  inspectRequestPrompt, inspectSystemPrompt,
} from '@deepseek-ai/dsh-client-ui-conversation/src/client/portable.ts'
import { registerChatConversation } from '../src/client/portable.ts'
import type { ChatSnapshot } from '../src/client/portable.ts'

function composition() {
  const ctx = new Context()
  const events = new ConversationEventRegistry(ctx)
  const views = new ConversationViewRegistry(ctx)
  registerChatConversation({ events, views, inspectRequestPrompt, inspectSystemPrompt })
  const feed = new MutableSessionEventSource()
  const binding = new ConversationBindingModel(feed, new ConversationNodeAssembler(events, views), null)
  return { ctx, events, views, feed, binding, target: binding.target('chat') }
}

function current(value: ReturnType<typeof composition>): ChatSnapshot {
  const snapshot = value.target.getSnapshot()
  if (snapshot === undefined) throw new Error('Chat target is inactive')
  return snapshot
}

describe('portable Chat business composition', () => {
  it('shares prompt inspection and avoids duplicating the system row at its request header', async () => {
    const value = composition()
    const off = value.target.subscribe(() => {})
    try {
      value.feed.replace([
        { type: 'event', event: { type: 'turn/start', seq: SessionSeq(1), time: 1, data: { turn: 1 } } },
        { type: 'event', event: { type: 'step/start', seq: SessionSeq(2), time: 2, data: { turn: 1, step: 1 } } },
        { type: 'event', event: { type: 'system/message', seq: SessionSeq(3), time: 3, surfaceOp: 'append', data: {
          turn: 1, step: 1, message: { id: MessageId('system'), role: 'system',
            content: [{ type: 'text', text: 'Follow the instructions.' }], source: { kind: 'plugin', plugin: 'fixture' } },
        } } },
        { type: 'event', event: { type: 'request/header', seq: SessionSeq(4), time: 4,
          data: { reason: 'initial', header: { config: { provider: 'fixture', model: 'fixture' } } },
        } },
      ], false)
      const prompts = current(value).nodes.values().filter(node => node.kind === 'system-prompt' && node.visibility === 'visible')
      expect(prompts).toHaveLength(1)
      expect(prompts[0]?.data).toEqual({ text: 'Follow the instructions.' })
    } finally {
      off()
      value.binding.dispose()
      await value.ctx.fiber.dispose()
    }
  })

  it('owns the complete Chat vocabulary and releases every contribution with its Context', async () => {
    const value = composition()
    try {
      expect(value.events.entries().map(definition => definition.kind)).toEqual([
        'inbox-next-step', 'input-message', 'system-message', 'request-prompt', 'assistant-step', 'turn-process',
        'tool-call', 'command', 'compaction', 'model-retry', 'turn-error', 'turn-max-tokens', 'turn-tail',
      ])
      expect(value.events.fallbackEntry()?.kind).toBe('unknown-surface')
      expect(value.views.entries().map(definition => definition.target)).toEqual(['chat'])
    } finally {
      value.binding.dispose()
      await value.ctx.fiber.dispose()
    }
    expect(value.events.entries()).toEqual([])
    expect(value.events.fallbackEntry()).toBeUndefined()
    expect(value.views.entries()).toEqual([])
  })

  it('uses the shared Session window for stable streamed Chat nodes and history replacement', async () => {
    const value = composition()
    const off = value.target.subscribe(() => {})
    try {
      value.feed.append({ type: 'event', event: { type: 'turn/start', seq: SessionSeq(1), time: 1, data: { turn: 1 } } })
      value.feed.append({ type: 'event', event: {
        type: 'user/message', seq: SessionSeq(2), time: 2, surfaceOp: 'append',
        data: { id: MessageId('human'), role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } },
      } })
      value.feed.append({ type: 'event', event: { type: 'step/start', seq: SessionSeq(3), time: 3, data: { turn: 1, step: 1 } } })
      value.feed.append({ type: 'transient', event: { type: 'assistant/live-chunk', seq: 4, time: 4, data: {
        attemptId: LlmAttemptId('attempt'), turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'first' },
      } } })
      const before = current(value)
      const assistant = before.nodes.values().find(node => node.kind === 'assistant-step')
      if (assistant === undefined) throw new Error('missing Assistant node')
      const source = before.nodes.source(assistant.key)
      expect(before.navigation.items()[0]).toMatchObject({ prompt: 'hello', response: 'first' })
      value.feed.append({ type: 'transient', event: { type: 'assistant/live-chunk', seq: 5, time: 5, data: {
        attemptId: LlmAttemptId('attempt'), turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: ' and more' },
      } } })
      expect(current(value).nodes.source(assistant.key)).toBe(source)
      expect(source.getSnapshot()?.key).toBe(assistant.key)
      expect(current(value).navigation.items()[0]?.response).toBe('first and more')
      value.feed.replace([], false)
      expect(current(value).order).toEqual([])
      expect(source.getSnapshot()).toBeUndefined()
    } finally {
      off()
      value.binding.dispose()
      await value.ctx.fiber.dispose()
    }
  })
})
