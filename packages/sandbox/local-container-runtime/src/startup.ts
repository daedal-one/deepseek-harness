/** Load-time validation for the assembled local-container execution world. @module @deepseek-ai/dsh-local-container-runtime/startup */

import type { Context } from '@deepseek-ai/cordis'
import type {} from './index.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    localContainerExecutionWorld: object
  }
}

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'local-container-execution-world-validator'
/** Runtime and provider services that must identify one ready execution world. */
export const inject = ['localContainerRuntime', 'fs', 'subprocess']

/**
 * Reject split-world providers and await the verified container before agents start.
 * @param ctx - context carrying the runtime owner and mounted provider pair.
 */
export async function apply(ctx: Context): Promise<void> {
  const runtime = ctx.get('localContainerRuntime')
  const fs = ctx.get('fs') as { executionWorld: symbol | object } | undefined
  const subprocess = ctx.get('subprocess') as { executionWorld: symbol | object } | undefined
  if (runtime === undefined || fs === undefined || subprocess === undefined) {
    throw new Error('local-container-runtime: validator requires runtime, filesystem, and subprocess services')
  }
  if (fs.executionWorld !== runtime.executionWorld || subprocess.executionWorld !== runtime.executionWorld) {
    throw new Error('local-container-runtime: filesystem and subprocess providers must share the configured local container execution world')
  }
  await runtime.getContainer()
  const dispose = ctx.provide('localContainerExecutionWorld', runtime.executionWorld)
  ctx.effect(() => dispose, 'verified local-container execution world')
}
