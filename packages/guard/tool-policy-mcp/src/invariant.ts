/** No additional durable invariant beyond dsh-tool-policy's event relationships. @module */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'tool-policy-mcp-invariant'
export const inject = ['invariants']

/** No runtime invariant: the provider emits events owned and validated by dsh-tool-policy. */
const install: InvariantInstaller = () => {}

/** Register the explained empty provider invariant. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-tool-policy-mcp', install))
