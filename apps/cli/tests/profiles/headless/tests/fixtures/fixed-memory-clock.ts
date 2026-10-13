/** Stable creation time for the assembled SQLite memory fixture. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-memory'

export const name = 'snapshot-fixed-memory-clock'
export const inject = ['memory']

/** Fix only synchronous proposal creation; policy deadlines keep the real clock. */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    // oxlint-disable-next-line typescript/unbound-method -- call supplies the original receiver; disposal restores the exact method.
    const propose = ctx.memory.propose
    ctx.memory.propose = function (request) {
      const now = Date.now
      Date.now = () => 1_700_000_000_000
      try {
        // SQLite creates its record before returning the proposal promise.
        return propose.call(this, request)
      } finally {
        Date.now = now
      }
    }
    return () => { ctx.memory.propose = propose }
  }, 'snapshot memory clock')
}
