/** Renderer-independent identity and publication contracts for Session interactions. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Common identity carried by every Session-scoped pending interaction. */
export interface SessionPendingInteractionBase {
  /** Opaque request identity; a replacement request must use a new key. */
  readonly key: string
  /** Domain-owned presentation discriminator. */
  readonly kind: string
  /** Session whose UI can answer this interaction. */
  readonly sessionId: SessionId
}

/** Declaration-merged roster of domain-owned pending interaction values. */
export interface SessionPendingInteractionMap {}

/** Every pending interaction contributed by the assembled Client. */
export type SessionPendingInteraction =
  [keyof SessionPendingInteractionMap] extends [never]
    ? SessionPendingInteractionBase
    : SessionPendingInteractionMap[keyof SessionPendingInteractionMap]

/** Current effective pending interaction by Session. */
export type SessionPendingInteractionSnapshot = ReadonlyMap<SessionId, SessionPendingInteraction>

/** Publish one pending interaction and define how plugin teardown delegates it. */
export type PendingInteractionPublisher<T extends SessionPendingInteractionBase> = (
  interaction: T,
  delegate: () => Promise<void>,
) => () => void
