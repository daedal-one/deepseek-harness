/** Bounded save attempts and diagnostics that never persist arbitrary subprocess output. @module */
import { randomUUID, createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkspaceSaveAttemptId, WorkspaceSaveStage, WorkspaceSaveDiagnostic, WorkspaceState } from './workspace-types.ts'

/** Owns one cancellation lifetime; aborted attempts cannot begin another side effect. */
export class WorkspaceSaveAttempt {
  /** Immutable identity joining active, completion, and failure receipts. */
  readonly id = brandString<WorkspaceSaveAttemptId>(randomUUID())
  /** Owner cancellation; consumers observe signal instead of starting another lifetime. */
  readonly controller = new AbortController()
  /** Shared cancellation for every stage and owned subprocess. */
  readonly signal = this.controller.signal
  /** Last admitted operation, retained for safe failure diagnostics. */
  stage: WorkspaceSaveStage = 'persistence'
  /** Supervisor-selected execution path associated with the current repository operation. */
  repository: string | undefined
  private phase: WorkspaceState['phase'] | 'created' = 'created'
  private readonly timer: ReturnType<typeof setTimeout>

  /** @param timeoutMs - total time allowed before cancellation is requested. */
  constructor(timeoutMs: number) {
    this.timer = setTimeout(() => { this.controller.abort(new Error('Workspace save deadline exceeded')) }, timeoutMs)
  }

  /** Stop admitting save side effects; callers must still join owned work. */
  cancel(): void { this.controller.abort(new Error('Workspace save cancelled')) }

  /** Clear the deadline after all owned work has settled. */
  dispose(): void { clearTimeout(this.timer) }

  /** Whether a successful publication has already been reported for this attempt. */
  get published(): boolean { return this.phase === 'returned' || this.phase === 'checkpointed' }

  /** Validate one attempt's observable lifecycle, including failure of terminal persistence.
   * @param phase - next save outcome; ready and legacy pending do not belong to an attempt.
   */
  transition(phase: WorkspaceState['phase']): void {
    const allowed = phase === 'saving' ? this.phase === 'created'
      : phase === 'cancelling' ? this.phase === 'created' || this.phase === 'saving'
        : phase === 'cancelled' ? this.phase === 'cancelling'
          : phase === 'returned' || phase === 'checkpointed' ? this.phase === 'saving'
            : phase === 'failed'
    if (!allowed) throw new Error(`Invalid workspace save transition: ${this.phase} -> ${phase}`)
    this.phase = phase
  }

  /** Run one stage while fencing both entry and continuation after cancellation.
   * @param stage - safe operation identity for diagnostics.
   * @param operation - owned operation; its promise must cover all side effects.
   * @returns the result only while the attempt remains active.
   */
  async run<T>(stage: WorkspaceSaveStage, operation: () => Promise<T>): Promise<T> {
    this.signal.throwIfAborted()
    this.stage = stage
    const result = await operation()
    this.signal.throwIfAborted()
    return result
  }
}

/** Await an operation for a bounded interval without asserting that timeout stopped it.
 * @param operation - already-owned promise whose late rejection remains observed.
 * @param timeoutMs - wait budget.
 * @returns true only when the promise settled before the deadline.
 */
export async function joinWorkspaceOperation(operation: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation.then(() => true, () => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => { resolve(false) }, timeoutMs) }),
    ])
  } finally { if (timer !== undefined) clearTimeout(timer) }
}

const SAFE_FAILURES = [
  ['workspace byte limit exceeded', 'quota', 'Workspace exceeds its configured byte limit.'],
  ['workspace entry limit exceeded', 'quota', 'Workspace exceeds its configured entry limit.'],
  ['escaping workspace symlink', 'symlink', 'Workspace contains a link outside its allowed directory.'],
  ['active writers did not stop', 'writers', 'Workspace writers did not stop before the deadline.'],
  ['active VM writers did not stop', 'writers', 'Workspace VM writers did not stop before the deadline.'],
  ['Workspace save deadline exceeded', 'deadline', 'Workspace save exceeded its total deadline.'],
  ['Workspace save cancelled', 'cancelled', 'Workspace save was cancelled by its owner.'],
  ['workspace Git command deadline exceeded', 'deadline', 'A workspace Git operation exceeded its deadline.'],
] as const

/** Convert nested failures into fixed safe messages; unknown text is represented only by a digest.
 * @param error - provider or controller failure, possibly containing secret subprocess output.
 * @param stage - operation that failed.
 * @param quiescent - whether owned work and writers have stopped.
 * @param repository - supervisor-owned execution path, never a provider error field.
 * @returns bounded diagnostics with at most eight causes, without raw error text.
 */
export function workspaceSaveDiagnostic(
  error: unknown, stage: WorkspaceSaveStage, quiescent: boolean, repository?: string,
): WorkspaceSaveDiagnostic {
  const pending: unknown[] = [error]
  const seen = new Set<unknown>()
  const causes: WorkspaceSaveDiagnostic['causes'] = []
  while (pending.length > 0 && seen.size < 8) {
    const cause = pending.shift()
    if (seen.has(cause)) continue
    seen.add(cause)
    const message = cause instanceof Error ? cause.message : ''
    const known = SAFE_FAILURES.find(([fragment]) => message.includes(fragment))
    causes.push(known === undefined
      ? { code: 'operation', message: 'Workspace operation failed; inspect retained files and the named stage.',
        fingerprint: createHash('sha256').update(message.slice(0, 4096)).digest('hex') }
      : { code: known[1], message: known[2] })
    if (cause instanceof AggregateError) {
      const nested: readonly unknown[] = cause.errors
      pending.push(...nested.slice(0, 8 - seen.size))
    }
    if (cause instanceof Error && cause.cause !== undefined && pending.length < 8) pending.push(cause.cause)
  }
  return { stage, quiescent, causes, ...repository === undefined ? {} : { repository } }
}
