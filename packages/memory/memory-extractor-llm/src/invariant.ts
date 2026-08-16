import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-memory-extractor-llm'
export const name = 'memory-extractor-llm-invariant'
export const inject = ['invariants']
/** Require every extraction request to settle exactly once in the same session. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: Parameters<InvariantInstaller>[1]) => {
  const pending = new WeakMap<object, Set<number>>()
  ctx.on('session/event', (session, event) => {
    let turns = pending.get(session)
    if (turns === undefined) { turns = new Set(); pending.set(session, turns) }
    if (event.type === 'memory/extraction-request') {
      if (turns.has(event.data.turn)) fail(`duplicate memory extraction request for turn ${event.data.turn}`)
      turns.add(event.data.turn)
    } else if (event.type === 'memory/extraction-result' && event.data.failure?.code !== 'queue-full') {
      if (!turns.delete(event.data.turn)) fail(`memory extraction result without request for turn ${event.data.turn}`)
    }
  })
}, { inject: ['sessions'] })
/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
