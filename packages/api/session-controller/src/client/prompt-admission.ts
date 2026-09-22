/** Positive prompt admission facts from one Session's authoritative read model. */
import { notifySubscribers, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { SessionRequestId } from '../types.ts'
import type { SessionEventChange, SessionEventLikeEntry } from './contract/events.ts'
import type { SessionBinding } from './sessions/service.ts'

/** Absence from the loaded window cannot establish rejection. */
export type PromptAdmissionState = 'unknown' | 'observed'

/** Watches one request without sending or retrying a mutation or loading more history. */
export class PromptAdmission implements ObservableSnapshot<PromptAdmissionState> {
  private state: PromptAdmissionState = 'unknown'
  private revision: number | undefined
  private closed = false
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: (() => void)[] = []

  /**
   * @param binding - Session and event source belonging to the same Host and Session.
   * @param requestId - original prompt identity, never text or a transport RPC identity.
   */
  constructor(
    private readonly binding: Pick<SessionBinding, 'session' | 'eventSource'>,
    private readonly requestId: SessionRequestId,
  ) {
    this.refresh()
    if (this.state === 'unknown') {
      this.unsubscribe.push(binding.session.subscribe(this.refresh), binding.eventSource.subscribe(this.refresh))
    }
  }

  /** @returns the latched positive observation, or unknown while no matching fact was received. */
  getSnapshot = (): PromptAdmissionState => this.state

  /** @param listener - observation callback. @returns the subscription disposer. */
  subscribe = (listener: () => void): (() => void) => {
    if (this.closed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private refresh = (): void => {
    if (this.closed || this.state === 'observed') return
    if (this.binding.session.getSnapshot().queue.some(item => item.rpcId === this.requestId)) {
      this.observe()
      return
    }
    const window = this.binding.eventSource.getSnapshot()
    if (window.revision === this.revision) return
    const contiguous = this.revision !== undefined && window.revision === this.revision + 1
    this.revision = window.revision
    const entries = contiguous ? changedEntries(window.change) : window.entries
    if (entries.some(entry => this.matches(entry))) this.observe()
  }

  private matches(entry: SessionEventLikeEntry): boolean {
    if (entry.type !== 'event' || entry.event.type !== 'user/message') return false
    const source = entry.event.data.source
    return source.kind === 'user' && 'rpcId' in source && source.rpcId === this.requestId
  }

  private observe(): void {
    this.state = 'observed'
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe()
    notifySubscribers(this.listeners, '[prompt-admission]')
  }

  /** Release read subscriptions and callbacks; the last observation remains readable. */
  dispose(): void {
    this.closed = true
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe()
    this.listeners.clear()
  }
}

function changedEntries(change: SessionEventChange): readonly SessionEventLikeEntry[] {
  switch (change.kind) {
    case 'append':
    case 'prepend':
    case 'replace': return change.entries
    case 'settle-assistant': return []
    /* v8 ignore next -- closed SessionEventChange union */
    default: return assertNever(change)
  }
}
