/** Normal ESM Client entry for portable Cordis compositions. */
import { apply as applyClient } from './index.ts'
export * from './index.ts'

/**
 * Install the Client plugin through a callback Cordis invokes as a function.
 * Binding prevents Cordis from treating a transpiled function as a constructor.
 * @param ctx - Client Cordis root with this plugin's injected services.
 * @returns nothing after the registry is installed.
 */
export const apply: (ctx: Parameters<typeof applyClient>[0]) => void = applyClient.bind(undefined)
