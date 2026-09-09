/** Package-owned durable English-output translation invariants. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-english-output-guard'

/** Cordis companion plugin name. */
export const name = 'english-output-guard-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

function validateSettled(events: readonly SessionEvent[], fail: InvariantFailure): void {
  const open = new Set<string>()
  const requests = new Map<string, SessionEvent<'english-output/translation-request'>>()
  const results = new Map<string, SessionEvent<'english-output/translation-result'>>()
  for (const event of events) {
    if (event.type === 'step/start') open.add(`${event.data.turn}:${event.data.step}`)
    if (event.type === 'english-output/translation-request') {
      const key = `${event.data.turn}:${event.data.step}`
      if (!open.has(key)) fail(`translation request ${key} lies outside an open step`)
      if (requests.has(key)) fail(`step ${key} has more than one translation request`)
      requests.set(key, event)
    }
    if (event.type === 'english-output/translation-result') {
      const key = `${event.data.turn}:${event.data.step}`
      if (!open.has(key)) fail(`translation result ${key} lies outside an open step`)
      if (!requests.has(key)) fail(`translation result ${key} has no request`)
      if (results.has(key)) fail(`step ${key} has more than one translation result`)
      results.set(key, event)
    }
    if (event.type === 'step/end') open.delete(`${event.data.turn}:${event.data.step}`)
  }
  for (const [key, request] of requests) {
    const result = results.get(key)
    if (result === undefined) {
      if (!open.has(key)) fail(`translation request ${key} has no result before step end`)
      continue
    }
    if (JSON.stringify(request.data.blocks.map(block => block.index)) !== JSON.stringify(result.data.blockIndexes)) {
      fail(`translation result ${key} does not identify the request blocks`)
    }
    if (result.data.status === 'translated' || result.data.status === 'blocked') {
      const message = events.find(event => event.type === 'assistant/message'
        && event.data.turn === request.data.turn && event.data.step === request.data.step
        && event.seq > result.seq)
      let turnEnd: SessionEvent<'turn/end'> | undefined
      for (const event of events) {
        if (event.type === 'turn/end' && event.data.turn === request.data.turn) turnEnd = event
      }
      if (message === undefined && turnEnd !== undefined && turnEnd.data.reason.kind !== 'aborted') {
        fail(`translation result ${key} has no canonical assistant message`)
      }
    }
  }
}

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) validateSettled(session.snapshotEvents(), fail)
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type === 'step/end' || event.type === 'turn/end') validateSettled([...session.snapshotEvents(), event], fail)
  }, { global: true })
}, { inject: ['sessions'] })

/** Register this package's durable invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
