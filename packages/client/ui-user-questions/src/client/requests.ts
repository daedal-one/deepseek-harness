/** Shared question consumer over the generated scoped Remote Event waterfall. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PendingInteractionPublisher } from '@deepseek-ai/dsh-client-ui-session/client/types'
import type { TypertClientEventListener } from '@deepseek-ai/dsh-typert-protocol'
import { PendingQuestion } from './pending-question.ts'

type QuestionListener = TypertClientEventListener<'user-questions/request'>
type ClientQuestionRequest = Parameters<QuestionListener>[0]
type ClientQuestionNext = Parameters<QuestionListener>[1]
type ClientQuestionAnswer = Awaited<ReturnType<QuestionListener>>

/** Present one request until the user answers, cancels, or its lifetime ends. */
async function answerQuestion(
  sessions: Pick<ISessions, 'scopeOf'>,
  owner: ClientContext,
  request: ClientQuestionRequest,
  next: ClientQuestionNext,
  registerPendingInteraction: PendingInteractionPublisher<PendingQuestion>,
): Promise<ClientQuestionAnswer> {
  const sessionId = sessions.scopeOf(owner)
  if (sessionId === undefined) return next()
  const pending = new PendingQuestion(sessionId, request.questions, request.signal)
  let finish!: () => void
  const completed = new Promise<void>((resolve) => { finish = resolve })
  let remove: () => void
  try {
    remove = registerPendingInteraction(pending, async () => {
      pending.delegate()
      await completed
    })
  } catch (error) {
    pending.abort(error)
    await Promise.allSettled([pending.result])
    finish()
    throw error
  }
  try {
    try {
      return await pending.result
    } catch (error) {
      if (pending.isDelegation(error)) return await next()
      throw error
    }
  } finally {
    remove()
    finish()
  }
}

/**
 * Register question delivery and its pending domain in the same caller-owned fiber.
 * The Remote service and domain registrar must belong to that fiber; its teardown
 * withdraws requests and waits for delegation before completing.
 * @param remote - Caller-scoped generated Remote service.
 * @param sessions - Session owner that resolves each delivered request's Context.
 * @param registerPendingInteraction - Caller-owned domain registration.
 */
export function registerQuestionRequests(
  remote: Pick<ClientRemote, '$on'>,
  sessions: Pick<ISessions, 'scopeOf'>,
  registerPendingInteraction: (
    precedence: (interaction: PendingQuestion) => number,
  ) => PendingInteractionPublisher<PendingQuestion>,
): void {
  const publish = registerPendingInteraction(pending => pending.kind === 'plan-review' ? 2 : 1)
  remote.$on('user-questions/request', function (request, next) {
    return answerQuestion(sessions, this, request, next, publish)
  })
}
