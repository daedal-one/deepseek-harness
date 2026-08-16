/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-agent-plane`.
 * @module @deepseek-ai/dsh-agent-plane/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-agent-plane'

/** Cordis companion plugin name. */
export const name = 'agent-plane-bundle-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package owns static patch rows; their mounted
// plugins own the mutable relationships that runtime checks can observe.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
