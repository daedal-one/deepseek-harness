/** No additional durable invariant beyond dsh-tool-policy's event relationships. @module @deepseek-ai/dsh-tool-policy-enforcer/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'tool-policy-enforcer-invariant'
export const inject = ['invariants']
/** Register the explained empty consumer invariant. */
/** No runtime invariant: dsh-tool-policy validates the durable decision relationships emitted here. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-tool-policy-enforcer', install))
