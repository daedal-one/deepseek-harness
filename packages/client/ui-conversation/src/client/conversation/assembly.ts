/** Per-Session target-neutral Conversation assembly. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  ISessions, SessionBinding,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ConversationPromptSnapshot, RequestPromptInspection, SystemPromptNode,
} from '../contract/request-inspection.ts'
import { inspectRequestPrompt } from '../contract/request-inspection.ts'
import { inspectSystemPrompt, type SystemPromptState } from '../contract/system-prompt.ts'
import { ConversationNodeAssembler } from './assembler.ts'
import { ConversationBindingModel, type ConversationBinding } from './binding.ts'
import { browserConversationScheduler } from './browser-scheduler.ts'
export type { ConversationBinding } from './binding.ts'
import { ConversationEventRegistry } from './event-registry.ts'
import { HistoricalImageCache } from './historical-images.ts'
import { ConversationViewRegistry } from './view-registry.ts'

interface BindingRecord {
  readonly source: SessionBinding
  readonly binding: ConversationBindingModel
  disposeScope: () => void
}

/** Root service owning Conversation registries and per-Session bindings. */
export class UiConversation extends Service {
  /** Registry of event matchers and target snapshot builders. */
  readonly events: ConversationEventRegistry
  /** Registry of target View definitions. */
  readonly views: ConversationViewRegistry
  private readonly bindings = new Map<SessionId, BindingRecord>()
  private readonly images: HistoricalImageCache

  /**
   * @param ctx - owning Client context.
   * @param sessions - Session Controller object layer.
   */
  constructor(ctx: Context, private readonly sessions: ISessions) {
    super(ctx, 'uiConversation')
    this.events = new ConversationEventRegistry(ctx)
    this.views = new ConversationViewRegistry(ctx)
    this.images = new HistoricalImageCache(ctx, sessions)
    const rebuild = (): void => {
      for (const record of this.bindings.values()) record.binding.rebuild()
    }
    let rebuildQueued = false
    const scheduleRebuild = (): void => {
      if (rebuildQueued) return
      rebuildQueued = true
      queueMicrotask(() => {
        rebuildQueued = false
        rebuild()
      })
    }
    ctx.effect(() => {
      const disposeEvents = this.events.subscribe(scheduleRebuild)
      const disposeViews = this.views.subscribe(scheduleRebuild)
      return () => {
        disposeViews()
        disposeEvents()
        for (const record of [...this.bindings.values()]) this.drop(record, true)
      }
    }, 'ui-conversation assembly')
  }

  /**
   * Resolve the Conversation binding for one Controller binding or Session id.
   * @param source - Session binding or identity.
   * @returns stable Conversation binding.
   */
  binding(source: SessionBinding | SessionId): ConversationBinding {
    const sessionId = typeof source === 'string' ? source : source.sessionId
    const owner = typeof source === 'string' ? this.sessions.binding(source) : source
    if (owner === undefined) throw new Error(`uiConversation.binding: unknown session "${sessionId}"`)
    const current = this.bindings.get(owner.sessionId)
    if (current?.source === owner) return current.binding
    if (current !== undefined) this.drop(current, true)
    const binding = new ConversationBindingModel(
      owner.eventSource,
      new ConversationNodeAssembler(this.events, this.views),
      browserConversationScheduler(),
    )
    const record: BindingRecord = { source: owner, binding, disposeScope: () => {} }
    this.bindings.set(owner.sessionId, record)
    const disposeScope = owner.ctx.effect(
      () => () => { this.drop(record, false) },
      'ui-conversation binding',
    )
    record.disposeScope = () => { void disposeScope() }
    return binding
  }

  /**
   * Resolve one session-authorized durable image URL, cached per Session so
   * every Conversation target shares one read and one browser URL.
   * @param sessionId - Session authorization and lifetime scope.
   * @param attachment - Durable image reference from a session event.
   * @returns browser URL valid until the Session binding is released.
   */
  imageUrl(sessionId: SessionId, attachment: ImageAttachmentRef): Promise<string> {
    return this.images.resolve(sessionId, attachment)
  }

  /**
   * Read a cached durable image URL synchronously when one is available.
   * @param sessionId - Session authorization and lifetime scope.
   * @param attachment - Durable image reference from a session event.
   * @returns current preview or canonical URL, if cached.
   */
  peekImageUrl(sessionId: SessionId, attachment: ImageAttachmentRef): string | undefined {
    return this.images.peek(sessionId, attachment)
  }

  /**
   * Adopt an already-displayable URL for one durable reference (see
   * HistoricalImageCache.seed): the transcript node then renders it without a
   * byte round-trip.
   * @param sessionId - Session authorization and lifetime scope.
   * @param attachment - Durable image reference the URL displays.
   * @param url - browser URL to adopt.
   * @returns whether the cache took URL ownership.
   */
  seedImageUrl(sessionId: SessionId, attachment: ImageAttachmentRef, url: string): boolean {
    return this.images.seed(sessionId, attachment, url)
  }

  /**
   * Interpret a system message or surface replacement for target-owned prompt Definitions.
   * @param previous - System facts at the preceding relevant loaded event.
   * @param event - Durable system message or positional replacement.
   * @returns Immutable prompt interpretation at this event.
   */
  inspectSystemPrompt(previous: SystemPromptState | undefined, event: SessionEvent): SystemPromptState {
    return inspectSystemPrompt(previous, event)
  }

  /**
   * Canonicalize one `request/header` event against the previous prompt state
   * and the `system/message` node in force.
   *
   * A pure interpretation shared by the Chat and Trajectory Definitions, exposed
   * as a service method because cross-plugin value imports are forbidden in
   * client bundles.
   * @param previous - prompt recorded by the preceding loaded header, if any.
   * @param event - the `request/header` session event to interpret.
   * @param system - effective prompt after loaded surface replacements, if any.
   * @returns the canonical prompt snapshot and any model-visible change.
   */
  inspectRequestPrompt(
    previous: ConversationPromptSnapshot | undefined,
    event: SessionEvent<'request/header'>,
    system: SystemPromptNode | undefined,
  ): RequestPromptInspection {
    return inspectRequestPrompt(previous, event, system)
  }

  private drop(record: BindingRecord, releaseScope: boolean): void {
    if (this.bindings.get(record.source.sessionId) !== record) return
    this.bindings.delete(record.source.sessionId)
    record.binding.dispose()
    if (releaseScope) record.disposeScope()
  }
}
