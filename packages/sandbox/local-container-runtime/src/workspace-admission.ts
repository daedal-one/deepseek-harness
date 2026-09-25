/** FIFO ownership of bounded workspace execution capacity. @module */

interface Waiter {
  admit: () => void
  cancel: () => void
}

/** Retains capacity until its owner finishes checkpointing and releases it. */
export class WorkspaceAdmission {
  private occupied = 0
  private readonly waiting: Waiter[] = []

  /** @param capacity - number of independently provisioned workspace slots. */
  constructor(private readonly capacity: number) {}

  /**
   * Reserve capacity in arrival order; cancellation withdraws only this request.
   * @param signal - caller lifetime while waiting for admission.
   * @returns an idempotent release callback; cancellation cannot release admitted capacity.
   */
  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        admit: () => {
          signal.removeEventListener('abort', waiter.cancel)
          this.occupied++
          let released = false
          resolve(() => {
            if (released) return
            released = true
            this.occupied--
            this.drain()
          })
        },
        cancel: () => {
          const index = this.waiting.indexOf(waiter)
          if (index < 0) return
          this.waiting.splice(index, 1)
          signal.removeEventListener('abort', waiter.cancel)
          reject(signal.reason instanceof Error ? signal.reason : new Error('workspace admission cancelled', { cause: signal.reason }))
          this.drain()
        },
      }
      this.waiting.push(waiter)
      signal.addEventListener('abort', waiter.cancel, { once: true })
      this.drain()
    })
  }

  private drain(): void {
    while (this.occupied < this.capacity) {
      const waiter = this.waiting.shift()
      if (waiter === undefined) return
      waiter.admit()
    }
  }
}
