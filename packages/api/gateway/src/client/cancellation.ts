/** Cancellation links whose event listeners have an explicit operation lifetime. */

/** A combined signal and the cleanup owned by its caller. */
export interface RemoteCancellationScope {
  /** Aborts with the first source's reason. */
  readonly signal: AbortSignal
  /** Remove source listeners when the operation finishes without cancellation. */
  dispose(): void
}

/**
 * Link operation lifetimes without requiring AbortSignal.any or garbage collection.
 * @param signals - cancellation sources, in priority order when already aborted.
 * @param createController - platform controller preserving abort reasons and signal helpers.
 * @returns combined signal; the owner must dispose it when its operation settles.
 */
export function combineRemoteCancellation(
  signals: readonly AbortSignal[],
  createController: () => AbortController,
): RemoteCancellationScope {
  const controller = createController()
  const listeners = new Map<AbortSignal, () => void>()
  const dispose = (): void => {
    for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener)
    listeners.clear()
  }
  const scope = { signal: controller.signal, dispose }
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return scope
    }
  }
  for (const signal of new Set(signals)) {
    const abort = (): void => {
      dispose()
      controller.abort(signal.reason)
    }
    listeners.set(signal, abort)
    signal.addEventListener('abort', abort, { once: true })
  }
  return scope
}
