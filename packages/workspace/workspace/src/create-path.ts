/** Existing-directory validation before Workspace registration writes. */

import { stat } from 'node:fs/promises'
import { realpathNormalize } from './paths.ts'

/** The requested path failed validation before this registration began writing. */
export class WorkspacePathInvalidError extends Error {
  /**
   * @param path - Requested Host path, before canonicalization.
   * @param cause - Filesystem or path validation failure.
   */
  constructor(readonly path: string, cause: unknown) {
    super(`Workspace path must name an existing, readable, fully qualified directory: '${path}'`, { cause })
    this.name = 'WorkspacePathInvalidError'
  }
}

/**
 * Validate and canonicalize a registration path without touching registry state.
 * @param path - Fully qualified Host directory path.
 * @returns the canonical directory path; validation failures retain their cause.
 */
export async function resolveWorkspaceCreatePath(path: string): Promise<string> {
  try {
    const canonical = await realpathNormalize(path)
    if (!(await stat(canonical)).isDirectory()) {
      throw new Error(`cannot create a workspace at '${canonical}': path is not a directory`)
    }
    return canonical
  } catch (error) {
    throw new WorkspacePathInvalidError(path, error)
  }
}
