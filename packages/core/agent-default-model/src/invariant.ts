/**
 * Package-owned invariant companion for persistent Agent model selections.
 *
 * Settings registration validates every stored value before `currentSelection()`
 * can observe it. Directory invalidations carry no independent state: the same
 * synchronous owner mutates the registry and then publishes the read-again cue.
 *
 * @module @deepseek-ai/dsh-agent-default-model/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-agent-default-model'

/** Cordis companion plugin name. */
export const name = 'agent-models-invariant'
/** Services required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: stored values are validated and directory events carry no state. */
const install: InvariantInstaller = () => {}

/**
 * Register the intentionally empty invariant contribution.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
