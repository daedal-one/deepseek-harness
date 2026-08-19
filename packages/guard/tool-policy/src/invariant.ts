/** Tool-policy durable relationship invariants. @module @deepseek-ai/dsh-tool-policy/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-policy'
export const name = 'tool-policy-invariant'
export const inject = ['invariants']

function validate(history: readonly SessionEvent[], event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'tool-policy/classifier-request'
    && event.type !== 'tool-policy/intent-context'
    && event.type !== 'tool-policy/decision') return
  if (event.type === 'tool-policy/intent-context') {
    const request = history.find(prior => prior.seq === event.data.requestSeq)
    if (request?.type !== 'tool-policy/classifier-request' || request.data.purpose !== 'intent-context') {
      fail('tool-policy/intent-context must reference its earlier intent-context request')
    }
    if (request.data.turn !== event.data.turn || request.data.providerId !== event.data.providerId) {
      fail('tool-policy/intent-context must match its request identity')
    }
    if (request.data.input.kind !== 'intent-context'
      || request.data.input.userMessageSeqs.at(-1) !== event.data.userMessageSeq) {
      fail('tool-policy/intent-context must name its request latest user message')
    }
    return
  }
  const open = history.findLast(prior => prior.type === 'turn/start' || prior.type === 'turn/end')
  if (open?.type !== 'turn/start' || open.data.turn !== event.data.turn) {
    fail(`${event.type} must name the current open turn`)
  }
  if (event.type === 'tool-policy/classifier-request') {
    const input = event.data.input
    if ((event.data.purpose === 'intent-context') !== (input.kind === 'intent-context')) {
      fail('tool-policy classifier purpose must match its input selector')
    }
    if (input.kind === 'intent-context') {
      if (event.data.callId !== undefined) fail('tool-policy intent-context request must not name a tool call')
      if (input.userMessageSeqs.length === 0
        || input.userMessageSeqs.some((seq, index) => index > 0 && seq <= (input.userMessageSeqs[index - 1] ?? seq))) {
        fail('tool-policy intent-context input must name ordered direct user messages')
      }
      for (const userMessageSeq of input.userMessageSeqs) {
        const user = history.find(prior => prior.seq === userMessageSeq)
        if (user?.type !== 'user/message' || user.data.source.kind !== 'user') {
          fail('tool-policy intent-context input must reference earlier direct user messages')
        }
      }
    } else {
      if (event.data.callId === undefined) fail('tool-policy effect request must name its tool call')
      const call = history.findLast((prior): prior is SessionEvent<'tool/call'> =>
        prior.type === 'tool/call' && prior.data.callId === event.data.callId)
      if (call === undefined) fail('tool-policy effect request must follow its tool/call')
      const context = history.find(prior => prior.seq === input.intentContextSeq)
      if (context?.type !== 'tool-policy/intent-context') {
        fail('tool-policy effect input must reference an earlier intent context')
      }
    }
    return
  }
  const call = history.findLast((prior): prior is SessionEvent<'tool/call'> =>
    prior.type === 'tool/call' && prior.data.callId === event.data.callId)
  if (call === undefined) fail('tool-policy/decision must follow its tool/call')
  if (event.data.toolName !== call.data.name) {
    fail('tool-policy/decision toolName must match its tool/call')
  }
  if (event.data.stage === 'effective') {
    const provider = history.findLast(prior => prior.type === 'tool-policy/decision'
      && prior.data.callId === event.data.callId && prior.data.stage === 'provider')
    if (provider === undefined) fail('an effective tool-policy/decision must follow a provider decision')
  }
}

function validateSession(session: Session, fail: InvariantFailure): void {
  for (const [index, event] of session.events.entries()) validate(session.events.slice(0, index), event, fail)
}

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) validateSession(session, fail)
  ctx.on('session/created', (session) => { validateSession(session, fail) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validate(session.events, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/** Register the package-owned session invariant. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
