/** Shared approval consumer over the generated scoped Remote Event waterfall. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PendingInteractionPublisher } from '@deepseek-ai/dsh-client-ui-session/client/types'
import type { TypertClientEventListener } from '@deepseek-ai/dsh-typert-protocol'
import { PendingApproval } from './pending-approval.ts'

type ApprovalListener = TypertClientEventListener<'approval/request'>
type ClientApprovalRequest = Parameters<ApprovalListener>[0]
type ClientApprovalNext = Parameters<ApprovalListener>[1]
type ClientApprovalOutcome = Awaited<ReturnType<ApprovalListener>>

/* jscpd:ignore-start -- Approval and Question intentionally mirror one Remote waterfall lifecycle. */
/** Present one request until the user answers or its lifetime ends. */
async function answerApproval(
  sessions: Pick<ISessions, 'scopeOf'>,
  owner: ClientContext,
  request: ClientApprovalRequest,
  next: ClientApprovalNext,
  registerPendingInteraction: PendingInteractionPublisher<PendingApproval>,
): Promise<ClientApprovalOutcome> {
  const sessionId = sessions.scopeOf(owner)
  if (sessionId === undefined) return next()
  const pending = new PendingApproval(sessionId, {
    toolName: request.toolName,
    ...(request.callId === undefined
      ? {}
      : { callId: request.callId }),
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  const completed = Promise.withResolvers<undefined>()
  let remove: () => void
  try {
    remove = registerPendingInteraction(pending, async () => {
      pending.delegate()
      await completed.promise
    })
  } catch (error) {
    pending.abort(error)
    await Promise.allSettled([pending.result])
    completed.resolve(undefined)
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
    completed.resolve(undefined)
  }
}
/* jscpd:ignore-end */

/**
 * Register approval delivery and its pending domain in the same caller-owned fiber.
 * The Remote service and domain registrar must belong to that fiber; its teardown
 * withdraws requests and waits for delegation before completing.
 * @param remote - Caller-scoped generated Remote service.
 * @param sessions - Session owner that resolves each delivered request's Context.
 * @param registerPendingInteraction - Caller-owned domain registration.
 */
export function registerApprovalRequests(
  remote: Pick<ClientRemote, '$on'>,
  sessions: Pick<ISessions, 'scopeOf'>,
  registerPendingInteraction: (
    precedence: (interaction: PendingApproval) => number,
  ) => PendingInteractionPublisher<PendingApproval>,
): void {
  const publish = registerPendingInteraction(() => 0)
  remote.$on('approval/request', function (request, next) {
    return answerApproval(sessions, this, request, next, publish)
  })
}
