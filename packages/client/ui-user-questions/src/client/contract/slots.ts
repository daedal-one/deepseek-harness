/** Browser question composer props and Session-scoped viewing drafts. */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createQuestionDraftStore } from '../draft-store.ts'
import type { QuestionWait } from '../pending-question.ts'

export type { PendingQuestion, PlanReview, QuestionAnswer, QuestionWait } from '../pending-question.ts'

/**
 * Full component props: the framework runtime share (chain currency +
 * session/global standard kit) plus the chain `matched` share — the entry's
 * selector result, already narrowed to the question carrier — plus the
 * standard locale seat; the carrier plus the domain face above carry the
 * whole behavior surface.
 */
export type QuestionComposerProps =
  PropsRuntime<'conversation.composer'>
  & PropsStore<ReturnType<typeof createQuestionDraftStore>>
  & { matched: QuestionWait }
  & PropsLocale<'question'>
