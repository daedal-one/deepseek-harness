/** Shared pending-interaction ownership without browser rendering or Session transport. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { notifySubscribers, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {
  PendingInteractionPublisher, SessionPendingInteractionBase, SessionPendingInteractionSnapshot,
} from './contract/pending-interactions.ts'

interface PendingInteractionEntry<T> {
  readonly interaction: T
  readonly delegate: () => Promise<void>
}

class PendingInteractionDomain<T extends SessionPendingInteractionBase> {
  private released = false
  private readonly values = new Map<string, PendingInteractionEntry<T>>()

  constructor(
    readonly precedence: (interaction: T) => number,
    private readonly changed: () => void,
  ) {}

  valuesSnapshot(): readonly T[] {
    return [...this.values.values()].map(entry => entry.interaction)
  }

  publish(interaction: T, delegate: () => Promise<void>): () => void {
    if (this.released) throw new Error('ui-session: pending interaction domain is disposed')
    if (this.values.has(interaction.key)) {
      throw new Error(`ui-session: duplicate pending interaction key '${interaction.key}'`)
    }
    this.values.set(interaction.key, { interaction, delegate })
    this.changed()
    let active = true
    return () => {
      if (!active) return
      active = false
      if (!this.values.delete(interaction.key)) return
      this.changed()
    }
  }

  /** Remove every pending value and return the operations that settle their owners. */
  release(): readonly (() => Promise<void>)[] {
    this.released = true
    const delegates = [...this.values.values()].map(entry => entry.delegate)
    this.values.clear()
    return delegates
  }
}

type RuntimePendingDomain = PendingInteractionDomain<SessionPendingInteractionBase>

/** Per-Host registry of effect-owned pending requests, shared across presentation targets. */
export class PendingInteractions {
  private readonly pendingDomains: RuntimePendingDomain[] = []
  private pendingSnapshot: ReadonlyMap<SessionId, SessionPendingInteractionBase> = new Map()
  private readonly pendingListeners = new Set<() => void>()
  /** Root source of pending UI interactions, independent from Controller snapshots. */
  readonly source: ObservableSnapshot<SessionPendingInteractionSnapshot> = {
    getSnapshot: () => this.pendingSnapshot,
    subscribe: (listener) => {
      this.pendingListeners.add(listener)
      return () => { this.pendingListeners.delete(listener) }
    },
  }

  /**
   * Register one pending-interaction domain and return its publication function.
   * Domain teardown first removes its visible values, then delegates and awaits
   * every still-active owner request.
   * Released domains reject subsequent publication.
   * @param ctx - Contributing plugin context that owns domain teardown.
   * @param precedence - deterministic cross-domain precedence; larger values win.
   * @returns a function that publishes one interaction and its teardown delegation.
   */
  register<T extends SessionPendingInteractionBase>(
    ctx: Context,
    precedence: (interaction: T) => number,
  ): PendingInteractionPublisher<T> {
    const domain = new PendingInteractionDomain(precedence, () => {
      this.publishPendingInteractions()
    })
    const runtimeDomain = domain as unknown as RuntimePendingDomain
    ctx.effect(() => {
      this.pendingDomains.push(runtimeDomain)
      this.publishPendingInteractions()
      return async () => {
        const delegates = domain.release()
        const index = this.pendingDomains.indexOf(runtimeDomain)
        this.pendingDomains.splice(index, 1)
        this.publishPendingInteractions()
        await Promise.allSettled(delegates.map(delegate => Promise.resolve().then(delegate)))
      }
    }, 'uiSession.registerPendingInteraction()')
    return (interaction, delegate) => domain.publish(interaction, delegate)
  }

  private publishPendingInteractions(): void {
    const next = new Map<SessionId, {
      interaction: SessionPendingInteractionBase
      precedence: number
    }>()
    for (const domain of this.pendingDomains) {
      for (const interaction of domain.valuesSnapshot()) {
        const precedence = domain.precedence(interaction)
        const previous = next.get(interaction.sessionId)
        if (previous === undefined || precedence >= previous.precedence) {
          next.set(interaction.sessionId, { interaction, precedence })
        }
      }
    }
    const projected = new Map(
      [...next].map(([sessionId, value]) => [sessionId, value.interaction] as const),
    )
    if (samePendingInteractions(this.pendingSnapshot, projected)) return
    this.pendingSnapshot = projected
    notifySubscribers(this.pendingListeners, '[ui-session] pending interactions')
  }
}

function samePendingInteractions(
  left: ReadonlyMap<SessionId, SessionPendingInteractionBase>,
  right: ReadonlyMap<SessionId, SessionPendingInteractionBase>,
): boolean {
  if (left.size !== right.size) return false
  for (const [sessionId, interaction] of left) {
    if (right.get(sessionId) !== interaction) return false
  }
  return true
}
