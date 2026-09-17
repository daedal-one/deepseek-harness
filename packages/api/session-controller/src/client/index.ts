/** Client Session object layer, Agent scopes, and Remote lifecycle wiring. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent/types'
import type {} from '@deepseek-ai/dsh-client-file-upload/client'
import type {} from '../remote-events.ts'
import { applySessions, inject as sessionInject } from './portable.ts'
import { createBrowserSessionClientOptions } from './browser.ts'

export { applySessions, inject as sessionInject } from './portable.ts'
export { PromptAdmission } from './prompt-admission.ts'
export type { PromptAdmissionState } from './prompt-admission.ts'
export type { SessionPlatform, SessionSelection, SessionSelectionStore, SessionClientOptions } from './platform.ts'

export {
  createSessionControlStream,
  SessionEventStream,
  SESSION_SEARCH_RESULT_LIMIT,
  SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS,
} from './transport.ts'
export type {
  ClientSessionPageRequest,
  SessionControlStream,
  SessionControlStreamOptions,
  SessionEventStreamOptions,
  SessionJournalChange,
  SessionRemote,
} from './transport.ts'
export { createScope, scopeOf } from './scope.ts'
export type { AgentContext, AgentScopeHandle } from './scope.ts'
export { SessionCreateError, SessionForkError } from './sessions/service.ts'
export type { SessionBinding, SessionListState, SessionSummary } from './sessions/service.ts'
export type {
  SessionListPhase,
  SessionListSnapshot,
  SessionSearchResultItem,
  SubagentCatalogSnapshot,
} from './sessions/manager.ts'
export type { Session } from './sessions/session.ts'
export type {
  ProjectionsBaseline,
  ProjectionValueStore,
  SessionProjectionMap,
  UseProjection,
} from './sessions/projection-store.ts'
export type {
  BeginSubmissionInput,
  ISession,
  PendingSubmissionRetirement,
  ProjectionsFace,
  SessionFace,
  SubmissionHandle,
} from './contract/session.ts'
export type { ISessions } from './contract/sessions.ts'
export { MutableSessionEventSource } from './contract/events.ts'
export type {
  AssistantLiveChunkEvent,
  SessionAssistantSettlementEntry,
  SessionEventChange,
  SessionEventLike,
  SessionEventLikeEntry,
  SessionEventSource,
  SessionEventWindow,
  SessionLiveEventEntry,
  SessionTransientEventEntry,
} from './contract/events.ts'
export type {
  OpenState,
  PendingSubmission,
  PendingSubmissionAttachment,
  PendingSubmissionFileAttachment,
  PendingSubmissionImage,
  PendingSubmissionImageAttachment,
  PendingSubmissionPlacement,
  PromptError,
  QueuedMessage,
  SessionSnapshot,
} from './contract/snapshot.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Client Session object layer and Agent scope owner. */
    sessions: import('./contract/sessions.ts').ISessions
  }
}

/** Required services for the browser Session and attachment composition. */
export const inject = [...sessionInject, 'fileUpload']

/**
 * Install Session state using browser identity, time zone and saved navigation.
 * @param ctx - Client Cordis context.
 */
export function apply(ctx: Context): void {
  applySessions(ctx, createBrowserSessionClientOptions())
}
