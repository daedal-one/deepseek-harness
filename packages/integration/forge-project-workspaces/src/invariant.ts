/** Package-owned invariant companion for Forge-managed Web workspaces. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-forge-project-workspaces'

/** Cordis companion plugin name. */
export const name = 'forge-project-workspaces-invariant'
/** Services required before the companion can register. */
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('internal/plugin', () => {
      const service = ctx.get('forgeProjectWorkspaces')
      if (service === undefined) return
      const paths = service.managed()
      if (new Set(paths).size !== paths.length) {
        fail('Forge project reconciliation published duplicate managed workspace paths')
      }
    }, { global: true })
  },
  { inject: ['forgeProjectWorkspaces'] },
)

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
