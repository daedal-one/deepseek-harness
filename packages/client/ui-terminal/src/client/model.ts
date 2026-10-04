/** Connection-owned terminal stream and bounded raw output; survives view remounts. */

import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionTerminalId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'

/** Immutable terminal projection consumed through the renderer hook. */
export interface TerminalSnapshot {
  readonly generation: number
  readonly offset: number
  readonly text: string
  readonly status: 'connecting' | 'open' | 'closed' | 'error'
  readonly cwd: string
  readonly error: string
}

/** One browser Session terminal, independent of Conversation View lifetime. */
export class TerminalModel {
  /** Stable observable bound to the renderer-owned terminal hook. */
  readonly source = createSnapshotStore<TerminalSnapshot>({
    generation: 0, offset: 0, text: '', status: 'closed', cwd: '', error: '',
  })
  private live: { abort: AbortController; terminalId: SessionTerminalId } | undefined
  private task: Promise<void> | undefined
  private inputLimit = 0
  private writes: Promise<void> = Promise.resolve()

  constructor(
    private readonly remote: ClientRemote,
    private readonly sessionId: SessionId,
    private readonly outputChars: number,
  ) {}

  /**
   * Open once on first display; view remounts reuse the stream.
   * @param rows - initial terminal rows.
   * @param cols - initial terminal columns.
   */
  start(rows: number, cols: number): void {
    if (this.task !== undefined) return
    const abort = new AbortController()
    const terminalId = randomUUID() as SessionTerminalId
    this.live = { abort, terminalId }
    this.source.set({ generation: this.source.getSnapshot().generation + 1,
      offset: 0, text: '', status: 'connecting', cwd: '', error: '' })
    this.task = this.consume(rows, cols, terminalId, abort)
  }

  /**
   * Replace a settled or running shell only after its stream has closed.
   * @param rows - initial rows for the new shell.
   * @param cols - initial columns for the new shell.
   * @returns completion of the previous stream before new admission.
   */
  async restart(rows: number, cols: number): Promise<void> {
    await this.dispose()
    this.start(rows, cols)
  }

  /**
   * Queue keyboard input in order, splitting paste text at the Host's advertised byte limit.
   * @param data - raw UTF-8 terminal input.
   */
  input(data: string): void {
    const live = this.live
    if (live === undefined || this.source.getSnapshot().status !== 'open') return
    const { terminalId, abort } = live
    const limit = this.inputLimit
    this.writes = this.writes.then(async () => {
      for (let offset = 0; offset < data.length;) {
        if (abort.signal.aborted) return
        let end = Math.min(offset + Math.floor(limit / 4), data.length)
        if (end < data.length && /[\uD800-\uDBFF]/u.test(data.charAt(end - 1))) {
          if (end - offset === 1) end++
          else end--
        }
        const result = await this.remote.session.terminalInput({ sessionId: this.sessionId,
          terminalId, data: data.slice(offset, end) }, abort.signal)
        if (!result.ok) throw new Error(result.error.message)
        offset = end
      }
    }).catch((error: unknown) => { if (!abort.signal.aborted) this.failure(error) })
  }

  /**
   * Send a new viewport to the live terminal.
   * @param rows - positive rows.
   * @param cols - positive columns.
   */
  resize(rows: number, cols: number): void {
    const live = this.live
    if (live === undefined || this.source.getSnapshot().status !== 'open') return
    const { terminalId, abort } = live
    void this.remote.session.terminalResize({ sessionId: this.sessionId, terminalId, rows, cols }, abort.signal)
      .then((result) => { if (!result.ok && !abort.signal.aborted) this.failure(new Error(result.error.message)) },
        (error: unknown) => { if (!abort.signal.aborted) this.failure(error) })
  }

  /** Abort the stream and await completion; never reconnect a shell automatically. */
  async dispose(): Promise<void> {
    this.live?.abort.abort()
    await this.task
    await this.writes
    this.task = undefined
    this.live = undefined
  }

  private async consume(rows: number, cols: number, terminalId: SessionTerminalId, abort: AbortController): Promise<void> {
    try {
      for await (const frame of this.remote.session.terminal({ sessionId: this.sessionId, terminalId, rows, cols }, abort.signal)) {
        if (abort.signal.aborted) break
        const current = this.source.getSnapshot()
        switch (frame.kind) {
          case 'ready':
            this.inputLimit = frame.maxInputBytes
            this.source.set({ ...current, status: 'open', cwd: frame.cwd })
            break
          case 'output': {
            const text = current.text + frame.data
            let cut = Math.max(0, text.length - this.outputChars)
            if (/[\uDC00-\uDFFF]/u.test(text.charAt(cut))) cut++
            this.source.set({ ...current, text: text.slice(cut), offset: current.offset + cut })
            break
          }
          case 'exit':
            this.source.set({ ...current, status: 'closed' })
            break
          /* v8 ignore next -- closed wire union, checked by the generated Remote decoder. */
          default: assertNever(frame)
        }
      }
      if (this.source.getSnapshot().status !== 'error') {
        this.source.set({ ...this.source.getSnapshot(), status: 'closed' })
      }
    } catch (error) {
      if (abort.signal.aborted) this.source.set({ ...this.source.getSnapshot(), status: 'closed' })
      else this.failure(error)
    }
  }

  private failure(error: unknown): void {
    this.source.set({ ...this.source.getSnapshot(), status: 'error',
      error: error instanceof Error ? error.message : String(error) })
  }
}
