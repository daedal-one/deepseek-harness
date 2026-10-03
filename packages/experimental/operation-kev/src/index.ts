/**
 * Private local Kev provider for the generic experimental operation judgment service.
 * @module @deepseek-ai/dsh-experimental-operation-kev
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveConfig, type Config } from './config.ts'
import { KevHttpProvider } from './provider.ts'

export { Config, resolveConfig } from './config.ts'
export type { KevServiceCaps } from './config.ts'
export { KevHttpProvider } from './provider.ts'
export { KevWireError } from './wire.ts'

/** Loader plugin identity. */
export const name = 'operation-kev'
/** Registry owner required before provider registration. */
export const inject = ['operations', 'credentials']

/**
 * Register one local provider; removal stops admission and drains its own requests.
 * @param ctx Owning composition context.
 * @param config Reviewed deployment identities and explicit limits.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const reference = resolved.credentialRef
  const provider = new KevHttpProvider(resolved, async () => (await ctx.credentials.resolve(credentialRef(reference)))?.value)
  ctx.effect(() => {
    const unregister = ctx.operations.registerJudgmentProvider(provider)
    return async () => { unregister(); await provider.dispose() }
  }, 'operation-kev.registerProvider()')
}
