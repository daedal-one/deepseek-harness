/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-subagent-result-status-block`.
 * @module @deepseek-ai/dsh-subagent-result-status-block/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-subagent-result-status-block'

/** Cordis companion plugin name. */
export const name = 'subagent-result-status-block-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the subagent registry owns duplicate-name and lifecycle relationships. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - context carrying the invariant service.
 * @returns the registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
