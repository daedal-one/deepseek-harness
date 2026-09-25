/** Prompt evidence follows authoritative queues and event-window revisions. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionId } from '@deepseek-ai/dsh-session/types'
import { PromptAdmission } from '../src/client/prompt-admission.ts'
import { MutableSessionEventSource, type SessionEventWindow, type SessionEventLikeEntry } from '../src/client/contract/events.ts'
import { Session } from '../src/client/sessions/session.ts'
import type { SessionRequestId, SessionQueuedItem } from '../src/types.ts'
import { FakeApiClient, fakeRemote } from './fake-api.client.ts'

const sessions: Session[] = []
afterEach(async () => {
  await Promise.all(sessions.splice(0).map(session => session.dispose()))
})

const requestId = 'request-one' as SessionRequestId
function harness() {
  const session = new Session('session-one' as SessionId, fakeRemote(new FakeApiClient()), {
    createRequestId: () => requestId, timeZone: () => 'UTC',
  })
  sessions.push(session)
  const eventSource = new MutableSessionEventSource()
  return { session, eventSource }
}
function message(source: MessageSource, seq = 1): SessionEventLikeEntry {
  return { type: 'event', event: { type: 'user/message', seq: SessionSeq(seq), time: seq,
    data: createUserMessage({ content: [{ type: 'text', text: 'same text' }], source }), surfaceOp: 'append' } }
}
function queue(id: SessionRequestId): SessionQueuedItem {
  return { id: 'queued' as SessionQueuedItem['id'], placement: 'queued', rpcId: id,
    message: { id: 'queued' as SessionQueuedItem['id'], content: [{ type: 'text', text: 'same text' }] } }
}

describe('PromptAdmission', () => {
  it('observes existing durable evidence and retains it after the window is replaced', () => {
    const binding = harness()
    binding.eventSource.replace([message({ kind: 'user', rpcId: requestId })], true)
    const observer = new PromptAdmission(binding, requestId)
    expect(observer.getSnapshot()).toBe('observed')
    binding.eventSource.replace([], false)
    expect(observer.getSnapshot()).toBe('observed')
    observer.dispose()
  })

  it('ignores local echoes, matching text without the identity, and another Session', () => {
    const binding = harness(); const other = harness()
    const observer = new PromptAdmission(binding, requestId)
    binding.session.beginSubmission({ mode: 'queue', text: 'same text', attachments: [] })
    binding.eventSource.append({ type: 'event', event: { type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } } })
    binding.eventSource.append(message({ kind: 'user' }))
    binding.eventSource.append(message({ kind: 'user', rpcId: 'other' as SessionRequestId }, 2))
    binding.eventSource.append(message({ kind: 'plugin', plugin: 'fixture' }, 3))
    other.eventSource.append(message({ kind: 'user', rpcId: requestId }))
    expect(observer.getSnapshot()).toBe('unknown')
    observer.dispose()
  })

  it('observes an exact queue occurrence without interpreting removal as rejection', async () => {
    const binding = harness(); const observer = new PromptAdmission(binding, requestId)
    binding.session.handleControlFrame({ type: 'queue', sessionId: binding.session.sessionId, items: [queue(requestId)] })
    await vi.waitFor(() => { expect(observer.getSnapshot()).toBe('observed') })
    binding.session.handleControlFrame({ type: 'queue', sessionId: binding.session.sessionId, items: [] })
    expect(observer.getSnapshot()).toBe('observed')
    observer.dispose()
  })

  it.each(['append', 'prepend', 'replace'] as const)('observes a matching %s and notifies once', (change) => {
    const binding = harness(); const observer = new PromptAdmission(binding, requestId)
    const notified = vi.fn(); const off = observer.subscribe(notified)
    const entry = message({ kind: 'user', rpcId: requestId })
    if (change === 'append') binding.eventSource.append(entry)
    else binding.eventSource[change]([entry], false)
    binding.eventSource.replace([entry], false)
    expect(observer.getSnapshot()).toBe('observed'); expect(notified).toHaveBeenCalledOnce()
    off(); observer.dispose()
  })

  it('reads full history after a revision gap and skips unchanged and assistant-only revisions', () => {
    const binding = harness()
    let current: SessionEventWindow = { entries: [], hasMore: true, revision: 0, change: { kind: 'replace', entries: [] } }
    const listeners = new Set<() => void>()
    const eventSource = {
      getSnapshot: () => current,
      subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    }
    const observer = new PromptAdmission({ session: binding.session, eventSource }, requestId)
    const publish = () => { for (const fn of listeners) fn() }
    publish()
    current = { ...current, revision: 1, change: { kind: 'settle-assistant', attemptId: 'attempt' as never } }; publish()
    current = { ...current, revision: 4, entries: [message({ kind: 'user', rpcId: requestId })], change: { kind: 'append', entries: [] } }; publish()
    expect(observer.getSnapshot()).toBe('observed'); expect(listeners.size).toBe(0)
    observer.dispose()
  })

  it('unsubscribes callbacks and both sources on disposal, refusing late evidence', () => {
    const binding = harness(); const callbacks = new Set<() => void>(); let removed = 0
    const observed = { session: binding.session, eventSource: {
      getSnapshot: () => binding.eventSource.getSnapshot(),
      subscribe: (fn: () => void) => { callbacks.add(fn); return () => { removed++; callbacks.delete(fn) } },
    } }
    const observer = new PromptAdmission(observed, requestId); const notify = vi.fn(); const off = observer.subscribe(notify); off()
    const late = [...callbacks][0]
    if (!late) throw new Error('Missing subscribed callback')
    observer.dispose(); observer.dispose()
    binding.eventSource.append(message({ kind: 'user', rpcId: requestId })); late()
    observer.subscribe(notify)(); expect(notify).not.toHaveBeenCalled(); expect(removed).toBe(1)
    expect(observer.getSnapshot()).toBe('unknown')
  })
})
