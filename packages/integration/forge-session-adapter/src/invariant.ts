/** Package-owned invariant companion for the Forge session adapter. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-forge-session-adapter'
export const name = 'forge-session-adapter-invariant'
export const inject = ['invariants']

/** No runtime invariant: records are validated transactionally at mutation boundaries. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
