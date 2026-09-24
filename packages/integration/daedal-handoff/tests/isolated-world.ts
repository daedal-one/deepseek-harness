/** Snapshot-only namespace identities; no container isolation is claimed by this fixture. */
import type { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
const identity = Symbol('snapshot isolated world')
class FixtureFiles extends LocalFileSystem { override get executionWorld(): symbol { return identity } }
class FixtureProcesses extends LocalSubprocessRuntime { override get executionWorld(): symbol { return identity } }
export const name = 'handoff-isolated-world-fixture'
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(FixtureFiles)
  await ctx.plugin(FixtureProcesses)
}
