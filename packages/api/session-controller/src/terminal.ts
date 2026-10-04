/** User terminal ownership through the selected Agent's subprocess provider. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import type { SessionTerminalFrame, SessionTerminalInput, SessionTerminalSize, SessionTerminalTarget } from './types.ts'

/** Validated deployment policy for browser terminals. */
export interface TerminalPolicy {
  readonly argv: readonly [string, ...string[]]
  readonly graceMs: number
  readonly maxInputBytes: number
  readonly maxTerminals: number
}

/** Owns admitted terminal streams, including allocation and awaited teardown. */
export class SessionTerminals {
  private readonly live = new Map<string, { sessionId: SessionId; handle: SubprocessTerminalHandle }>()
  private readonly opening = new Set<string>()
  private readonly controllers = new Set<AbortController>()
  private readonly operations = new Set<Promise<void>>()
  private disposing = false

  constructor(private readonly policy: TerminalPolicy) {}

  /**
   * Allocate a PTY in the Agent's execution world; stream cancellation owns teardown.
   * @param agent - selected Session's live composition.
   * @param request - caller identity and initial dimensions.
   * @param signal - authenticated stream lifetime.
   * @returns ordered terminal output followed by exit facts.
   */
  async *open(agent: Agent, request: SessionTerminalSize, signal: AbortSignal): AsyncGenerator<SessionTerminalFrame> {
    this.size(request)
    signal.throwIfAborted()
    if (this.disposing) throw new Error('terminal service is disposing')
    if (this.live.has(request.terminalId) || this.opening.has(request.terminalId)) throw new Error('terminal is already open')
    if (this.live.size + this.opening.size >= this.policy.maxTerminals) throw new Error('terminal capacity reached')
    const subprocess = agent.ctx.get('subprocess')
    if (subprocess === undefined) throw new Error('session has no terminal subprocess provider')
    const cwd = agent.session.header.cwd
    if (cwd === undefined) throw new Error('session has no working directory')
    this.opening.add(request.terminalId)
    const controller = new AbortController()
    this.controllers.add(controller)
    const lifetime = AbortSignal.any([signal, controller.signal])
    const completion = Promise.withResolvers<undefined>()
    this.operations.add(completion.promise)
    let handle: SubprocessTerminalHandle | undefined
    const stop = (): void => { handle?.output.destroy() }
    try {
      const allocation = await agent.ctx.agents.withInitiator(agent, async () => {
        const executable = await subprocess.resolveExecutable(this.policy.argv[0], undefined, lifetime)
        lifetime.throwIfAborted()
        const executionCwd = subprocess.resolveWorkingDirectory(cwd)
        const terminal = await subprocess.spawnTerminal({
          argv: [executable, ...this.policy.argv.slice(1)], cwd: executionCwd,
          env: { TERM: 'xterm-256color' }, rows: request.rows, cols: request.cols,
          graceMs: this.policy.graceMs, signal: lifetime,
        })
        return { terminal, cwd: executionCwd }
      })
      handle = allocation.terminal
      // Attach rejection handling before consuming output: a failed transport can settle done first.
      const outcome = handle.done.then(value => ({ value }), (error: unknown) => ({ error }))
      this.opening.delete(request.terminalId)
      this.live.set(request.terminalId, { sessionId: request.sessionId, handle })
      this.operations.delete(completion.promise)
      completion.resolve(undefined)
      lifetime.addEventListener('abort', stop, { once: true })
      lifetime.throwIfAborted()
      yield { kind: 'ready', cwd: allocation.cwd, maxInputBytes: this.policy.maxInputBytes }
      handle.output.setEncoding('utf8')
      for await (const chunk of handle.output) {
        lifetime.throwIfAborted()
        const data = String(chunk)
        // Bound each wire frame without splitting UTF-16 surrogate pairs.
        for (let offset = 0; offset < data.length;) {
          let end = Math.min(offset + this.policy.maxInputBytes, data.length)
          if (end < data.length && /[\uD800-\uDBFF]/u.test(data.charAt(end - 1))) end--
          yield { kind: 'output', data: data.slice(offset, end) }
          offset = end
        }
      }
      lifetime.throwIfAborted()
      const result = await outcome
      if ('error' in result) throw result.error
      yield { kind: 'exit', ...result.value }
    } finally {
      lifetime.removeEventListener('abort', stop)
      this.opening.delete(request.terminalId)
      try {
        await handle?.terminate()
      } finally {
        this.live.delete(request.terminalId)
        this.controllers.delete(controller)
        this.operations.delete(completion.promise)
        completion.resolve(undefined)
      }
    }
  }

  /**
   * Deliver bounded input to an existing Session-owned terminal.
   * @param request - exact terminal owner and raw keyboard input.
   * @returns completion of the provider write.
   */
  async input(request: SessionTerminalInput): Promise<void> {
    if (Buffer.byteLength(request.data) > this.policy.maxInputBytes) throw new Error('terminal input exceeds configured limit')
    await this.target(request).write(request.data)
  }

  /**
   * Resize an existing Session-owned terminal.
   * @param request - exact owner and new dimensions.
   * @returns completion of the provider resize.
   */
  async resize(request: SessionTerminalSize): Promise<void> {
    this.size(request)
    await this.target(request).resize(request.rows, request.cols)
  }

  /** Stop new admission and await every admitted stream's process cleanup. */
  async dispose(): Promise<void> {
    this.disposing = true
    for (const controller of this.controllers) controller.abort()
    await Promise.all([...this.operations])
    const outcomes = await Promise.allSettled([...this.live.values()].map(terminal => terminal.handle.terminate()))
    this.live.clear()
    this.controllers.clear()
    const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])
    if (failures.length > 0) throw new AggregateError(failures, 'terminal process cleanup failed')
  }

  private target(request: SessionTerminalTarget): SubprocessTerminalHandle {
    const terminal = this.live.get(request.terminalId)
    if (terminal === undefined || terminal.sessionId !== request.sessionId) throw new Error('terminal is not open for this session')
    return terminal.handle
  }

  private size(request: SessionTerminalSize): void {
    if (!Number.isSafeInteger(request.rows) || !Number.isSafeInteger(request.cols)
      || request.rows < 1 || request.cols < 2 || request.rows > 1000 || request.cols > 1000) {
      throw new Error('terminal dimensions must be integers within 1–1000 rows and 2–1000 columns')
    }
  }
}
