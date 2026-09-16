/** Portable event-window subscription and publication for Conversation targets. */
import type { SessionEventSource, SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type ObservableSnapshot, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConversationPublication, ConversationViewSnapshotMap, ConversationViewSnapshotStore } from '../contract/conversation.ts'
import type { ConversationSnapshot } from '../contract/snapshot.ts'
import type { ConversationNodeAssembler } from './assembler.ts'

/** Platform-owned deferred publication. Each callback runs at most once and never synchronously. */
export interface ConversationScheduler {
  /**
   * @param publish - callback scheduled after this call returns.
   * @returns cancellation for queued work; a racing late callback is ignored by the binding.
   */
  schedule(publish: () => void): () => void
}

/** Observable faces published for one Session's Conversation assembly. */
export interface ConversationBinding {
  readonly snapshot: ObservableSnapshot<ConversationSnapshot>
  /**
   * Add one selected target to the Session's monotonic active set.
   * @param target - registered or subsequently registered Conversation target.
   */
  activate(target: string): void
  /**
   * Resolve one target-owned snapshot source.
   * The first subscriber activates the target unless shell selection already
   * activated it; activation lasts for the remaining Session lifetime.
   * @param target - registered Conversation target.
   * @returns identity-stable source following the target.
   */
  target<Target extends Extract<keyof ConversationViewSnapshotMap, string>>(
    target: Target,
  ): ObservableSnapshot<ConversationViewSnapshotMap[Target] | undefined>
}

/** One portable Session event-window owner with platform-supplied publication timing. */
export class ConversationBindingModel implements ConversationBinding {
  readonly snapshot: ObservableSnapshot<ConversationSnapshot>
  private readonly store: SnapshotStore<ConversationSnapshot>
  private readonly viewStore: ConversationViewSnapshotStore
  private readonly targetSources = new Map<string, ObservableSnapshot<unknown>>()
  private revision = -1
  private cancelPublication: (() => void) | undefined
  private publicationEpoch = 0
  private disposed = false
  private readonly disposeFeed: () => void

  /**
   * @param feed - shared contiguous Session window; this binding never opens a transport.
   * @param assembler - exclusively owned assembler with the selected Definitions.
   * @param scheduler - deferred streaming publication, or null for immediate publication.
   */
  constructor(
    feed: SessionEventSource,
    private readonly assembler: ConversationNodeAssembler,
    private readonly scheduler: ConversationScheduler | null,
  ) {
    this.viewStore = assembler
    this.store = createSnapshotStore(this.currentSnapshot())
    this.snapshot = this.store
    this.replace(feed.getSnapshot())
    this.disposeFeed = feed.subscribe(() => {
      this.accept(feed.getSnapshot())
    })
  }

  /** @param target - registered target key. @returns identity-stable target source. */
  target<Target extends Extract<keyof ConversationViewSnapshotMap, string>>(
    target: Target,
  ): ObservableSnapshot<ConversationViewSnapshotMap[Target] | undefined> {
    let source = this.targetSources.get(target)
    if (source === undefined) {
      const views = this.viewStore as unknown as { get(key: string): unknown }
      source = {
        getSnapshot: () => views.get(target),
        subscribe: (listener) => {
          const unsubscribe = this.snapshot.subscribe(listener)
          this.activate(target)
          return unsubscribe
        },
      }
      this.targetSources.set(target, source)
    }
    return source as ObservableSnapshot<ConversationViewSnapshotMap[Target] | undefined>
  }

  /** @param target - target to activate for this binding; ignored after disposal. */
  activate(target: string): void {
    if (this.disposed) return
    if (this.assembler.activateTarget(target)) this.store.set(this.currentSnapshot())
  }

  /** Rebuild contributed Definitions while retaining this binding and target sources. */
  rebuild(): void {
    if (!this.disposed) this.publish(this.assembler.rebuildRegistry())
  }

  /** Detach the source and cancel publication; retained snapshots remain readable. Idempotent. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disposeFeed()
    this.cancelScheduled()
  }

  private replace(window: SessionEventWindow): void {
    this.revision = window.revision
    this.publish(this.assembler.replaceWindow(window.entries, window.hasMore))
  }

  private accept(window: SessionEventWindow): void {
    if (this.disposed || window.revision === this.revision) return
    if (window.revision !== this.revision + 1 || window.change.kind === 'replace') {
      this.replace(window)
      return
    }
    this.revision = window.revision
    switch (window.change.kind) {
      case 'prepend':
        this.publish(this.assembler.prepend(window.change.entries, window.hasMore))
        return
      case 'append': {
        let publication: ConversationPublication = 'none'
        for (const event of window.change.entries) {
          const next = this.assembler.append(event)
          if (next === 'immediate' || publication === 'none') publication = next
        }
        this.publish(publication)
        return
      }
      case 'settle-assistant':
        this.publish(this.assembler.settleAssistant(
          window.change.attemptId,
          window.change.entry,
        ))
        return
    }
  }

  private publish(publication: ConversationPublication): void {
    if (publication === 'none') return
    if (publication === 'animation-frame' && this.scheduler !== null) {
      if (this.cancelPublication !== undefined) return
      const epoch = this.publicationEpoch
      this.cancelPublication = this.scheduler.schedule(() => {
        if (this.disposed || epoch !== this.publicationEpoch) return
        this.cancelPublication = undefined
        this.flush()
      })
      return
    }
    this.cancelScheduled()
    this.flush()
  }

  private cancelScheduled(): void {
    this.publicationEpoch++
    const cancel = this.cancelPublication
    this.cancelPublication = undefined
    cancel?.()
  }

  private flush(): void {
    if (this.assembler.flush()) this.store.set(this.currentSnapshot())
  }

  private currentSnapshot(): ConversationSnapshot {
    return {
      views: this.viewStore,
      activeTargets: this.assembler.activityTargets(),
    }
  }
}
