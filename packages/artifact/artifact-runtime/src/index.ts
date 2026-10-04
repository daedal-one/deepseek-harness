/** Independent execution capability for untrusted artifact revisions. @module */
import { Context, Service } from '@deepseek-ai/cordis'
import type { ArtifactInvocation, ArtifactRuntimeInput } from './types.ts'
export type * from './types.ts'
declare module '@deepseek-ai/cordis' {
  interface Context {
    artifactRuntime: ArtifactRuntime
  }
}
/** Providers must enforce network denial and resource bounds independently of Session execution. */
export abstract class ArtifactRuntime extends Service {
  /**
   * @param ctx - capability registration context.
   */
  constructor(ctx: Context) {
    super(ctx, 'artifactRuntime')
  }
  /**
   * Allocate one independently confined runtime lifetime.
   * @param input - one complete immutable revision without Session authority.
   * @param signal - invocation cancellation.
   * @returns independently owned sandbox invocation.
   */
  abstract open(input: ArtifactRuntimeInput, signal: AbortSignal): Promise<ArtifactInvocation>
}
export default ArtifactRuntime
