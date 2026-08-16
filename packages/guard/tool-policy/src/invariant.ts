/** Tool-policy durable relationship invariants. @module @deepseek-ai/dsh-tool-policy/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-policy'
export const name = 'tool-policy-invariant'
export const inject = ['invariants']

function validate(history: readonly SessionEvent[], event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'tool-policy/classifier-request' && event.type !== 'tool-policy/decision') return
  const call = history.findLast((prior): prior is SessionEvent<'tool/call'> =>
    prior.type === 'tool/call' && prior.data.callId === event.data.callId)
  if (call === undefined) fail(`${event.type} must follow its tool/call`)
  const open = history.findLast(prior => prior.type === 'turn/start' || prior.type === 'turn/end')
  if (open?.type !== 'turn/start' || open.data.turn !== event.data.turn) {
    fail(`${event.type} must name the current open turn`)
  }
  if (event.type === 'tool-policy/decision' && event.data.toolName !== call.data.name) {
    fail('tool-policy/decision toolName must match its tool/call')
  }
  if (event.type === 'tool-policy/decision' && event.data.stage === 'effective') {
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
