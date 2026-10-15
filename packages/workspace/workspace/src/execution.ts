/** Execution preparation before Workspace registration and Session creation. @module */
import type { Context } from '@deepseek-ai/cordis'

/** Workspace registration names a Host directory; raw Session cwd may name an admitted guest directory. */
export type WorkspacePreparationKind = 'workspace' | 'session'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Prepare the selected directory in the composed execution world before publication.
     * @param path - selected Host working directory; registration callers supply its canonical spelling.
     * @param kind - whether the selection names a Host Workspace or a Session execution directory.
     * @mode serial
     */
    'workspace/prepare'(path: string, kind: WorkspacePreparationKind): Promise<void>
  }
}

/** Execution preparation failed before the caller began registration or Session creation. */
export class WorkspaceExecutionUnavailableError extends Error {
  /**
   * @param path - selected Host directory.
   * @param cause - execution provider's preparation failure.
   */
  constructor(readonly path: string, cause: unknown) {
    super(`Cannot prepare workspace '${path}': ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    this.name = 'WorkspaceExecutionUnavailableError'
  }
}

/**
 * Await execution providers before publishing a selected directory; Host-only compositions have no preparation effects.
 * @param ctx - context carrying the execution providers' effect-scoped listeners.
 * @param path - selected Host working directory.
 * @param kind - Workspace selection by default; raw Session admission may retain guest-directory aliases.
 * @returns resolution after every provider confirms readiness.
 */
export async function prepareWorkspaceExecution(ctx: Context, path: string, kind: WorkspacePreparationKind = 'workspace'): Promise<void> {
  try { await ctx.serial('workspace/prepare', path, kind) }
  catch (error) { throw new WorkspaceExecutionUnavailableError(path, error) }
}
