/** No runtime invariant beyond dsh-tool-policy's durable event relationships. @module @deepseek-ai/dsh-tool-policy-shell/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'tool-policy-shell-invariant'
export const inject = ['invariants']
/** Register the explained empty provider invariant. */
/** No runtime invariant: the provider emits events owned and validated by dsh-tool-policy. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-tool-policy-shell', install))
