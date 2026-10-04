/** Compare publication events with independently retained manifest receipts. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-artifact'
import { artifactDomain } from './schema.ts'
/** Package companion identity. */
export const name = 'artifact-durable-invariant'
/** Diagnostic registry required before installing this owner. */
export const inject = ['invariants']
const install: InvariantInstaller = Object.assign(
  async (ctx: Context, fail: (message: string) => never) => {
    const domain = await ctx.storageDomain.open(artifactDomain)
    ctx.effect(() => () => domain.close(), 'artifact.invariantLedger')
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'artifact/published') return
      const revision = event.data.revision
      const receipt = domain.global.get().operations.find(value => value.revisionId === revision.revisionId)
      if (
        receipt === undefined ||
        receipt.abandoned ||
        receipt.revision === null ||
        receipt.sessionId !== session.id ||
        JSON.stringify(receipt.revision) !== JSON.stringify(revision)
      )
        fail('Publication event diverges from its captured durable manifest receipt.')
    })
  },
  { inject: ['artifacts', 'storageDomain'] },
)
/** Register the publication-event and durable-receipt relationship check.
 * @param ctx - owned diagnostics context.
 * @returns diagnostic registration disposer after setup.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-artifact-durable', install))
