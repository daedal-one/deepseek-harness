/**
 * Rootless-Podman implementation of `ctx.subprocess`. Each spawned range owns
 * one removable sibling container that shares the runtime workspace.
 * @module @deepseek-ai/dsh-subprocess-local-container
 */

import type {} from '@deepseek-ai/dsh-local-container-runtime/workspaces'
import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { PassThrough, type Readable, type Writable } from 'node:stream'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessCollect,
  SubprocessHandle,
  SubprocessOutputRead,
  SubprocessOutputReader,
  SubprocessOutcome,
  SubprocessSpawnSpec,
  SubprocessTerminalForeground,
  SubprocessTerminalHandle,
  SubprocessTerminalSignal,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import type {
  LocalContainerProcessHandle,
  WorkspaceExecutionRuntime,
  LocalContainerProcessRequest,
} from '@deepseek-ai/dsh-local-container-runtime'
import { WORKSPACE_PATH } from '@deepseek-ai/dsh-local-container-runtime'
import z from '@deepseek-ai/schemastery'

const MAX_TIMER_DELAY_MS = 2_147_483_647
const MAX_FRAME_BYTES = 16 * 1024 * 1024

/** Provider-specific controller and cwd mapping bounds. */
export interface Config {
  /** Exact host Session cwd values that map to `/workspace`. */
  cwdAliases: string[]
  /** Maximum bytes accepted from one executable or terminal-control response. */
  controlOutputBytes: number
  /** Deadline for executable lookup and spill publication. */
  controlTimeoutMs: number
}

class TailCollector implements SubprocessOutputReader {
  private chunks: Buffer[] = []
  private bytes = 0
  private total = 0
  private full: Buffer[] | undefined
  private fullBytes = 0
  private spillPath: string | undefined

  constructor(private readonly mode: SubprocessCollect) {
    this.full = mode.spill === undefined ? undefined : []
  }

  push(chunk: Buffer): void {
    this.total += chunk.length
    if (this.full !== undefined) {
      this.fullBytes += chunk.length
      if (this.mode.spill !== undefined && this.fullBytes <= this.mode.spill.maxBytes) this.full.push(chunk)
      else this.full = undefined
    }
    this.chunks.push(chunk)
    this.bytes += chunk.length
    while (this.bytes > this.mode.maxBytes) {
      const head = this.chunks[0]
      if (head === undefined) break
      const excess = this.bytes - this.mode.maxBytes
      if (head.length <= excess) {
        this.chunks.shift()
        this.bytes -= head.length
      } else {
        this.chunks[0] = head.subarray(excess)
        this.bytes -= excess
      }
    }
  }

  readFrom(fromByte: number): SubprocessOutputRead {
    if (!Number.isSafeInteger(fromByte) || fromByte < 0) throw new Error('subprocess-local-container: output offset must be a non-negative safe integer')
    const windowStart = this.total - this.bytes
    const retained = Buffer.concat(this.chunks)
    const lossy = fromByte < windowStart
    const text = (lossy ? retained : retained.subarray(Math.min(retained.length, fromByte - windowStart))).toString('utf8')
    return { text, nextOffset: this.total, lossy, ...this.spillPath === undefined ? {} : { spillPath: this.spillPath } }
  }

  async seal(runtime: WorkspaceExecutionRuntime, label: 'stdout' | 'stderr', timeoutMs: number): Promise<void> {
    if (this.full === undefined || this.total <= this.mode.maxBytes) return
    const path = `${WORKSPACE_PATH}/.dsh-spill/${randomUUID()}-${label}.log`
    const result = await runtime.executeController({
      argv: ['/usr/bin/python3', '-c', 'import os,sys; p=sys.argv[1]; os.makedirs(os.path.dirname(p), mode=0o700, exist_ok=True); f=os.open(p, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600); data=sys.stdin.buffer.read(); os.write(f,data); os.fsync(f); os.close(f)', path],
      stdin: Buffer.concat(this.full),
      maxOutputBytes: 1024,
      deadlineMs: timeoutMs,
    })
    if (result.exitCode !== 0) throw new Error('subprocess-local-container: spill publication failed')
    this.spillPath = path
    this.full = undefined
  }
}

interface OutputBinding {
  readonly exposed: Readable | undefined
  readonly collector: TailCollector | undefined
  push(chunk: Buffer): Promise<void>
  seal(): Promise<void>
  fail(error: unknown): void
}

function outputBinding(
  mode: SubprocessSpawnSpec['stdio']['stdout'],
  inherited: NodeJS.WriteStream,
  runtime: WorkspaceExecutionRuntime,
  label: 'stdout' | 'stderr',
  timeoutMs: number,
): OutputBinding {
  const exposed = mode === 'pipe' ? new PassThrough() : undefined
  const collector = typeof mode === 'object' ? new TailCollector(mode) : undefined
  return {
    exposed,
    collector,
    async push(chunk) {
      collector?.push(chunk)
      const destination = mode === 'pipe' ? exposed : mode === 'inherit' ? inherited : undefined
      if (destination !== undefined && !destination.write(chunk)) await once(destination, 'drain')
    },
    async seal() {
      if (exposed !== undefined) exposed.end()
      if (collector !== undefined) await collector.seal(runtime, label, timeoutMs)
    },
    fail(error) {
      if (exposed !== undefined) exposed.destroy(asError(error))
    },
  }
}

class ContainerSubprocessHandle implements SubprocessHandle {
  readonly stdin: Writable | undefined
  readonly stdout: Readable | undefined
  readonly stderr: Readable | undefined
  readonly collected: { stdout?: SubprocessOutputReader; stderr?: SubprocessOutputReader }
  readonly done: Promise<SubprocessOutcome>
  private readonly allocation = new AbortController()
  private process: LocalContainerProcessHandle | undefined
  private terminateRequested = false

  constructor(
    private readonly runtime: WorkspaceExecutionRuntime,
    private readonly spec: SubprocessSpawnSpec,
    config: Config,
  ) {
    const stdin = spec.stdio.stdin === 'pipe' ? new PassThrough() : undefined
    const stdout = outputBinding(spec.stdio.stdout, process.stdout, runtime, 'stdout', config.controlTimeoutMs)
    const stderr = outputBinding(spec.stdio.stderr, process.stderr, runtime, 'stderr', config.controlTimeoutMs)
    this.stdin = stdin
    this.stdout = stdout.exposed
    this.stderr = stderr.exposed
    this.collected = {
      ...stdout.collector === undefined ? {} : { stdout: stdout.collector },
      ...stderr.collector === undefined ? {} : { stderr: stderr.collector },
    }
    this.done = this.run(stdin, stdout, stderr)
    void this.done.catch(() => undefined)
    if (spec.signal !== undefined) {
      spec.signal.addEventListener('abort', () => { this.terminate() }, { once: true })
    }
  }

  terminate(): void {
    this.terminateRequested = true
    this.allocation.abort()
    void this.process?.terminate().catch(() => undefined)
  }

  async waitForExit(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted === true) return false
    const processHandle = this.process
    if (processHandle !== undefined) return await processHandle.waitForRemoval(signal)
    if (signal === undefined) {
      await this.done.catch(() => undefined)
      return true
    }
    return await new Promise<boolean>((resolve) => {
      const aborted = (): void =>{  resolve(false) }
      signal.addEventListener('abort', aborted, { once: true })
      void this.done.catch(() => undefined).then(() =>{  resolve(true) }).finally(() =>{  signal.removeEventListener('abort', aborted) })
    })
  }

  private async run(stdin: PassThrough | undefined, stdout: OutputBinding, stderr: OutputBinding): Promise<SubprocessOutcome> {
    const signal = this.spec.signal === undefined
      ? this.allocation.signal
      : AbortSignal.any([this.spec.signal, this.allocation.signal])
    let processHandle: LocalContainerProcessHandle | undefined
    try {
      processHandle = await this.runtime.createProcess({
        argv: this.spec.argv as [string, ...string[]],
        cwd: this.spec.cwd as LocalContainerProcessRequest['cwd'],
        environment: this.spec.env ?? {},
        tty: false,
        stdin: this.spec.stdio.stdin !== 'ignore',
        signal,
      })
      this.process = processHandle
      if (this.terminateRequested) await processHandle.terminate()
      if (stdin !== undefined) stdin.pipe(processHandle.stream)
      else if (typeof this.spec.stdio.stdin === 'object') processHandle.stream.end(this.spec.stdio.stdin.data)
      await decodeMultiplexed(processHandle.stream, stdout, stderr)
      const outcome = await processHandle.done
      await Promise.all([stdout.seal(), stderr.seal()])
      return { exitCode: outcome.exitCode, signal: null }
    } catch (error) {
      stdout.fail(error)
      stderr.fail(error)
      if (processHandle !== undefined) await processHandle.terminate().catch(() => undefined)
      throw error
    }
  }
}

class ContainerTerminalHandle implements SubprocessTerminalHandle {
  readonly pid = 1
  readonly output: Readable
  readonly done: Promise<SubprocessOutcome>
  private terminating: Promise<void> | undefined

  constructor(
    private readonly process: LocalContainerProcessHandle,
    private readonly controlOutputBytes: number,
  ) {
    this.output = process.stream
    this.done = process.done.then(outcome => ({ exitCode: outcome.exitCode, signal: null }))
  }

  async write(data: string): Promise<void> {
    if (!this.process.stream.write(data)) await once(this.process.stream, 'drain')
  }

  async inspectForeground(): Promise<SubprocessTerminalForeground | undefined> {
    if (this.process.inspectTerminalForeground !== undefined) return await this.process.inspectTerminalForeground()
    const result = await this.process.inspect([
      '/bin/sh', '-c', 'p=$(ps -o tpgid= -p 1 | tr -d " "); test -n "$p" && printf "%s %s" "$p" "1"',
    ], this.controlOutputBytes)
    if (result.exitCode !== 0) return undefined
    const match = /^(\d+) ([01])$/u.exec(result.output.trim())
    if (match === null) throw new Error('subprocess-local-container: invalid terminal foreground response')
    return { processGroupId: Number(match[1]), inputWaiting: match[2] === '1' }
  }

  async signalForeground(signal: SubprocessTerminalSignal): Promise<number> {
    if (this.process.signalTerminalForeground !== undefined) return await this.process.signalTerminalForeground(signal)
    const foreground = await this.inspectForeground()
    if (foreground === undefined) throw new Error('subprocess-local-container: terminal foreground process group is unavailable')
    if (foreground.processGroupId === 1) {
      await this.process.signal(signal)
      return foreground.processGroupId
    }
    const result = await this.process.inspect([
      '/bin/kill', `-${signal}`, '--', `-${foreground.processGroupId}`,
    ], this.controlOutputBytes)
    if (result.exitCode !== 0) throw new Error(`subprocess-local-container: terminal foreground signal failed for group ${foreground.processGroupId}: ${result.output.trim()}`)
    return foreground.processGroupId
  }

  async terminate(): Promise<void> {
    this.terminating ??= this.process.terminate()
    await this.terminating
  }
}

/** Container-backed subprocess provider. */
export class LocalContainerSubprocessRuntime extends SubprocessRuntime {
  static inject = ['localContainerRuntime']
  static Config: z<Config> = z.object({
    cwdAliases: z.array(z.string()).required(),
    controlOutputBytes: z.natural().required(),
    controlTimeoutMs: z.natural().required(),
  })

  private readonly config: Config
  private readonly live = new Set<ContainerSubprocessHandle>()
  private readonly terminals = new Set<ContainerTerminalHandle>()
  private disposing = false

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = resolveConfig(config)
    ctx.effect(() => async () => {
      this.disposing = true
      for (const handle of this.live) handle.terminate()
      const outcomes = await Promise.allSettled([
        ...[...this.live].map(async (handle) => { await handle.done.catch(() => undefined); await handle.waitForExit() }),
        ...[...this.terminals].map(async (terminal) => { await terminal.terminate(); await terminal.done.catch(() => undefined) }),
      ])
      this.live.clear()
      this.terminals.clear()
      const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw new AggregateError(failures, 'subprocess-local-container: teardown failed')
    }, 'local-container subprocess teardown')
  }

  override get executionWorld(): object {
    return this.ctx.get('conversationWorkspaces')?.executionWorld ?? this.ctx.localContainerRuntime.executionWorld
  }

  override resolveWorkingDirectory(path: string): string {
    const workspaces = this.ctx.get('conversationWorkspaces')
    if (workspaces !== undefined) {
      path = workspaces.executionPath(path)
      if (path !== WORKSPACE_PATH && (!path.startsWith(`${WORKSPACE_PATH}/`) || posix.normalize(path) !== path)) throw new Error('subprocess cwd is outside the conversation workspace')
      return path
    }
    if (path === WORKSPACE_PATH || this.config.cwdAliases.includes(path)) return WORKSPACE_PATH
    if (path.startsWith(`${WORKSPACE_PATH}/`) && posix.normalize(path) === path) return path
    throw new Error('subprocess-local-container: cwd is not a configured workspace path')
  }

  override async resolveExecutable(command: string, env: Readonly<Record<string, string>> = {}, signal?: AbortSignal): Promise<string> {
    validateValue('executable', command)
    if (!posix.isAbsolute(command) && command.includes('/')) {
      throw new Error(`subprocess-local-container: command ${JSON.stringify(command)} is a relative path; use an absolute path or bare PATH name`)
    }
    const path = env.PATH ?? '/usr/local/bin:/usr/bin:/bin'
    const script = posix.isAbsolute(command)
      ? 'test -f "$1" -a -x "$1" && printf "%s" "$1"'
      : 'command -v -- "$1"'
    const result = await (this.ctx.get('conversationWorkspaces')?.resolveToolchain() ?? this.ctx.localContainerRuntime).executeController({
      argv: ['/usr/bin/env', '-i', `PATH=${path}`, '/bin/sh', '-c', script, 'dsh', command],
      stdin: new Uint8Array(),
      maxOutputBytes: this.config.controlOutputBytes,
      deadlineMs: this.config.controlTimeoutMs,
      ...signal === undefined ? {} : { signal },
    })
    const resolved = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout).trim()
    if (result.exitCode !== 0 || !posix.isAbsolute(resolved) || resolved.includes('\n')) {
      throw new Error(`subprocess-local-container: command ${JSON.stringify(command)} was not found in the execution world`)
    }
    return resolved
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.validateSpawn(spec)
    const handle = new ContainerSubprocessHandle(this.ctx.get('conversationWorkspaces')?.capture() ?? this.ctx.localContainerRuntime, { ...spec, cwd: this.resolveWorkingDirectory(spec.cwd) }, this.config)
    this.live.add(handle)
    const release = async (): Promise<void> => { await handle.waitForExit(); this.live.delete(handle) }
    void handle.done.then(release, release).catch(() => undefined)
    return handle
  }

  override async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    this.validateTerminal(spec)
    const processHandle = await (this.ctx.get('conversationWorkspaces')?.capture() ?? this.ctx.localContainerRuntime).createProcess({
      argv: spec.argv as [string, ...string[]],
      cwd: this.resolveWorkingDirectory(spec.cwd) as LocalContainerProcessRequest['cwd'],
      environment: { ...(spec.env ?? {}), TERM: spec.env?.TERM ?? 'xterm-256color' },
      tty: true,
      stdin: true,
      rows: spec.rows,
      cols: spec.cols,
      ...spec.signal === undefined ? {} : { signal: spec.signal },
    })
    const terminal = new ContainerTerminalHandle(processHandle, this.config.controlOutputBytes)
    this.terminals.add(terminal)
    const release = async (): Promise<void> => { await processHandle.waitForRemoval(); this.terminals.delete(terminal) }
    void terminal.done.then(release, release).catch(() => undefined)
    return terminal
  }

  private validateSpawn(spec: SubprocessSpawnSpec): void {
    if (this.disposing) throw new Error('subprocess-local-container: service is disposing')
    validateArgv(spec.argv)
    validateGrace(spec.graceMs)
    spec.signal?.throwIfAborted()
    validateEnvironment(spec.env)
    validateOutputMode(spec.stdio.stdout)
    validateOutputMode(spec.stdio.stderr)
    this.resolveWorkingDirectory(spec.cwd)
  }

  private validateTerminal(spec: SubprocessTerminalSpawnSpec): void {
    if (this.disposing) throw new Error('subprocess-local-container: service is disposing')
    validateArgv(spec.argv)
    validateGrace(spec.graceMs)
    positive('terminal rows', spec.rows)
    positive('terminal columns', spec.cols)
    spec.signal?.throwIfAborted()
    validateEnvironment(spec.env)
    this.resolveWorkingDirectory(spec.cwd)
  }
}

async function decodeMultiplexed(stream: Readable, stdout: OutputBinding, stderr: OutputBinding): Promise<void> {
  let buffered: Buffer = Buffer.alloc(0)
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array)
    buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk])
    while (buffered.length >= 8) {
      const kind = buffered[0]
      if (buffered[1] !== 0 || buffered[2] !== 0 || buffered[3] !== 0 || (kind !== 1 && kind !== 2)) {
        throw new Error('subprocess-local-container: invalid Engine multiplex frame')
      }
      const length = buffered.readUInt32BE(4)
      if (length > MAX_FRAME_BYTES) throw new Error('subprocess-local-container: Engine multiplex frame exceeded the transport bound')
      if (buffered.length < length + 8) break
      const payload = buffered.subarray(8, length + 8)
      await (kind === 1 ? stdout : stderr).push(payload)
      buffered = buffered.subarray(length + 8)
    }
  }
  if (buffered.length !== 0) throw new Error('subprocess-local-container: Engine multiplex stream ended with a partial frame')
}

function resolveConfig(config: Config): Config {
  const aliases = [...config.cwdAliases]
  if (aliases.some(alias => alias.length === 0 || alias.includes('\0')) || new Set(aliases).size !== aliases.length) {
    throw new Error('subprocess-local-container: cwdAliases must be unique non-empty paths')
  }
  positive('controlOutputBytes', config.controlOutputBytes)
  positive('controlTimeoutMs', config.controlTimeoutMs, MAX_TIMER_DELAY_MS)
  return { ...config, cwdAliases: aliases }
}

function validateArgv(argv: readonly string[]): void {
  if (argv.length === 0) throw new Error('subprocess-local-container: argv must contain a program')
  argv.forEach((value, index) =>{  validateValue(`argv[${index}]`, value) })
}

function validateEnvironment(environment: NodeJS.ProcessEnv | undefined): void {
  for (const [name, value] of Object.entries(environment ?? {})) {
    validateValue('environment name', name)
    if (value !== undefined) validateValue(`environment ${name}`, value)
  }
}

function validateOutputMode(mode: SubprocessSpawnSpec['stdio']['stdout']): void {
  if (typeof mode !== 'object') return
  positive('collected output maxBytes', mode.maxBytes)
  if (mode.spill !== undefined) positive('spill maxBytes', mode.spill.maxBytes)
}

function validateGrace(value: number): void {
  positive('graceMs', value, MAX_TIMER_DELAY_MS)
}

function positive(name: string, value: number, maximum = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`subprocess-local-container: ${name} must be a positive safe integer no greater than ${maximum}`)
  }
}

function validateValue(subject: string, value: string): void {
  if (value.length === 0 || value.includes('\0')) throw new Error(`subprocess-local-container: ${subject} must be non-empty and contain no null byte`)
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('subprocess-local-container: process failed', { cause: error })
}

export default LocalContainerSubprocessRuntime
