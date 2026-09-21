/** Optional conversation VM provider; Git maintenance remains in the isolated host controller. @module */
import type { ConversationWorkspaceId } from './workspace-types.ts'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { IncusDevelopmentVms, incusCommand, type DevelopmentVmConfig } from './vm-engine.ts'
import { createVmProcess, connectVmPreview } from './vm-process.ts'
import type { LocalContainerProcessHandle, LocalContainerProcessRequest, PodmanControllerExecRequest, PodmanControllerExecResult, WorkspaceExecutionRuntime } from './types.ts'

/** Deployment-owned VM and process bounds. */
export interface Config extends DevelopmentVmConfig {
  /** Complete non-secret guest process environment. */
  environment: Record<string, string>
  /** Maximum simultaneous attached guest commands. */
  maxLiveProcesses: number
  /** Maximum active lifetime before the guest is frozen for recovery. */
  lifetimeMs: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    developmentVms: DevelopmentVms
  }
}

/** Adds durable VM execution to supervisor-owned conversation workspaces. */
export class DevelopmentVms extends Service {
  static Config: z<Config> = z.object({
    command: z.string().required(), pythonCommand: z.string().required(), devicesRoot: z.string().required(),
    project: z.string().required(), storage: z.string().required(),
    network: z.string().required(), acl: z.string().required(), hostAddresses: z.array(z.string()).required(),
    image: z.string().required(), workspaceUid: z.natural().required(), workspaceGid: z.natural().required(),
    maxInstances: z.natural().required(), cpus: z.natural().required(),
    memoryBytes: z.natural().required(), diskBytes: z.natural().required(),
    timeoutMs: z.natural().required(), readinessPollMs: z.natural().required(), maxOutputBytes: z.natural().required(),
    environment: z.dict(z.string()).required(), maxLiveProcesses: z.natural().required(), lifetimeMs: z.natural().required(),
  })
  private readonly runtimes = new Set<VmWorkspace>()
  private readonly engine: IncusDevelopmentVms
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'developmentVms')
    this.engine = new IncusDevelopmentVms(config)
    if (!Number.isSafeInteger(config.maxLiveProcesses) || config.maxLiveProcesses < 1
      || !Number.isSafeInteger(config.lifetimeMs) || config.lifetimeMs < 1 || config.lifetimeMs > 2_147_483_647) throw new Error('development-vm: invalid process or lifetime bound')
    environment(config.environment)
    ctx.effect(() => async () => {
      const results = await Promise.allSettled([...this.runtimes].map(runtime => runtime.dispose()))
      const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      if (failures.length) throw new AggregateError(failures, 'development-vm: guest shutdown failed')
    }, 'development VM shutdown')
  }

  /** Stable host storage namespace persisted with each conversation's recovery record. */
  get identity(): string { return `${this.config.project}/${this.config.storage}` }

  async [Service.init](): Promise<void> { await this.engine.verifyNetwork() }

  /** Quiesce a retained guest before the workspace owner touches its RAM slot.
   * @param id - workspace identity derived by the trusted supervisor.
   */
  async recover(id: ConversationWorkspaceId): Promise<void> {
    await this.engine.verifyNetwork()
    if (await this.engine.exists(id)) await this.engine.stop(id)
  }

  /** Bind a prepared repository to its conversation's retained development VM.
   * @param base - isolated maintenance controller for the private source directory.
   * @param id - supervisor-derived workspace identity.
   * @param directory - prepared, private memory-backed source directory.
   * @param generation - acknowledged source recovery generation.
   * @param retained - whether unacknowledged RAM source survived and is still owned.
   * @param required - whether durable recovery already acknowledges this VM.
   * @returns runtime and disposer; disposal retains durable guest storage.
   */
  async open(
    base: WorkspaceExecutionRuntime, id: ConversationWorkspaceId, directory: string,
    generation: number, retained: boolean, required: boolean,
  ): Promise<{ runtime: WorkspaceExecutionRuntime; dispose(): Promise<void> }> {
    const exists = await this.engine.exists(id)
    if (required && !exists) throw new Error('development-vm: retained guest storage is missing; refusing a replacement')
    if (exists) {
      if (!retained) await this.engine.restore(id, generation, directory)
      await this.engine.verify(id, directory)
    } else await this.engine.create(id, directory)
    const runtime = new VmWorkspace(this.engine, this.config, base, id, this.ctx)
    this.runtimes.add(runtime)
    try {
      await this.engine.start(id)
      if (!exists) {
        await this.engine.freeze(id)
        await this.engine.checkpoint(id, generation)
        await this.engine.unfreeze(id)
      }
      return { runtime, dispose: async () => { await runtime.dispose(); this.runtimes.delete(runtime) } }
    } catch (error) {
      try { await runtime.dispose(); this.runtimes.delete(runtime) } catch (cleanup) { throw new AggregateError([error, cleanup], 'development-vm: startup and shutdown failed') }
      throw error
    }
  }
}

type ControllerRequest = PodmanControllerExecRequest & { readonly deadlineMs: number }

class VmWorkspace implements WorkspaceExecutionRuntime {
  readonly executionWorld: object
  readonly containerName: string
  private closed = false
  private disposal: Promise<void> | undefined
  private allocating = 0
  private readonly processes = new Set<LocalContainerProcessHandle>()
  private readonly controllers = new Set<Promise<unknown>>()
  private readonly allocations = new Set<Promise<unknown>>()
  private readonly timer: NodeJS.Timeout
  private readonly command: ReturnType<typeof incusCommand>

  constructor(private readonly engine: IncusDevelopmentVms, private readonly config: Config,
    private readonly base: WorkspaceExecutionRuntime, private readonly id: ConversationWorkspaceId, ctx: Context) {
    this.executionWorld = base.executionWorld; this.containerName = engine.name(id)
    this.command = incusCommand(config)
    this.timer = setTimeout(() => { void this.cancelProcesses().catch((error: unknown) => { ctx.logger.error(error) }) }, config.lifetimeMs)
    this.timer.unref()
  }

  async executeController(request: ControllerRequest): Promise<PodmanControllerExecResult> {
    if (this.closed) throw new Error('development-vm: workspace is being saved')
    const operation = this.runController(request)
    this.controllers.add(operation)
    try { return await operation } finally { this.controllers.delete(operation) }
  }

  private async runController(request: ControllerRequest): Promise<PodmanControllerExecResult> {
    // Guest lookup and file operations observe the same toolchain and namespace as shell commands.
    const process = await this.allocate({ argv: request.argv as [string, ...string[]], cwd: '/workspace',
      environment: this.config.environment, tty: false, stdin: true, ...request.signal === undefined ? {} : { signal: request.signal } })
    const stdout: Buffer[] = []; const stderr: Buffer[] = []
    let pending = Buffer.alloc(0); let size = 0
    let termination: Promise<void> | undefined
    let terminationFailure: unknown
    const timer = setTimeout(() => {
      termination = process.terminate().catch((error: unknown) => { terminationFailure = error })
    }, request.deadlineMs)
    try {
      process.stream.end(request.stdin)
      for await (const value of process.stream) {
        const chunk: Buffer = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array)
        pending = Buffer.concat([pending, chunk])
        while (pending.length >= 8) {
          const length = pending.readUInt32BE(4)
          if (length > request.maxOutputBytes || size + length > request.maxOutputBytes) throw new Error('development-vm: controller output limit exceeded')
          if (pending.length < 8 + length) break
          const channel = pending[0]
          if (channel !== 1 && channel !== 2) throw new Error('development-vm: invalid controller stream')
          ;(channel === 1 ? stdout : stderr).push(pending.subarray(8, 8 + length))
          size += length; pending = pending.subarray(8 + length)
        }
      }
      if (pending.length !== 0) throw new Error('development-vm: incomplete controller stream')
      const result = await process.done
      if (termination !== undefined) {
        await termination
        throw new Error('development-vm: controller deadline exceeded', { cause: terminationFailure })
      }
      request.signal?.throwIfAborted()
      if (result.error !== undefined || result.exitCode === null) throw new Error(result.error ?? 'development-vm: controller was terminated')
      return { exitCode: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }
    } catch (error) { await this.cancelProcesses(); throw error }
    finally { clearTimeout(timer) }
  }

  async createProcess(request: LocalContainerProcessRequest): Promise<LocalContainerProcessHandle> {
    if (this.closed) throw new Error('development-vm: workspace is being saved')
    const operation = this.allocate(request)
    this.allocations.add(operation)
    try { return await operation } finally { this.allocations.delete(operation) }
  }

  private async allocate(request: LocalContainerProcessRequest): Promise<LocalContainerProcessHandle> {
    if (this.processes.size + this.allocating >= this.config.maxLiveProcesses) throw new Error('development-vm: attached process limit reached')
    const replacement = environment({ ...this.config.environment, ...request.environment })
    this.allocating++
    try {
      const handle = await createVmProcess(this.config, this.containerName, { ...request, environment: replacement }, this.command)
      const terminate = handle.terminate.bind(handle)
      handle.terminate = async () => {
        try { await terminate() }
        catch (error) { this.closed = true; await this.engine.stop(this.id); throw error }
      }
      this.processes.add(handle)
      void handle.done.finally(() => this.processes.delete(handle)).catch(() => undefined)
      return handle
    } catch (error) { this.closed = true; await this.engine.stop(this.id); throw error }
    finally { this.allocating-- }
  }

  async settle<T>(
    timeoutMs: number, operation: (control: (request: ControllerRequest) => Promise<PodmanControllerExecResult>) => Promise<T>,
  ): Promise<T> {
    this.closed = true
    let deadline: NodeJS.Timeout | undefined
    try {
      await Promise.race([Promise.all([...this.allocations, ...this.controllers]), new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() =>{  reject(new Error('development-vm: attached controller did not settle')) }, timeoutMs)
      })])
    } finally { if (deadline !== undefined) clearTimeout(deadline) }
    const state = await this.engine.state(this.id)
    if (state === 'Running' || state === 'Frozen') await this.engine.freeze(this.id)
    else if (state !== 'Frozen' && state !== 'Stopped') throw new Error('development-vm: cannot establish workspace barrier')
    // The maintenance container shares only private source storage and remains outside the frozen guest.
    const result = await this.base.settle(timeoutMs, operation)
    if (state !== 'Stopped') { await this.engine.unfreeze(this.id); this.closed = false }
    return result
  }

  async checkpoint(generation: number): Promise<void> { await this.engine.checkpoint(this.id, generation) }

  async pruneCheckpoints(generation: number): Promise<void> { await this.engine.prune(this.id, generation) }

  async cancelProcesses(): Promise<void> {
    this.closed = true
    await Promise.allSettled([...this.allocations])
    await this.engine.stop(this.id)
    await this.base.cancelProcesses()
  }

  async connectPreview(port: number): Promise<import('node:stream').Duplex> {
    if (this.closed) throw new Error('development-vm: workspace is being saved')
    return await connectVmPreview(this.config, this.containerName, port)
  }

  async dispose(): Promise<void> { clearTimeout(this.timer); await (this.disposal ??= this.cancelProcesses()) }
}

function environment(values: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    if (!/^[A-Z_][A-Z0-9_]*$/u.test(key) || /KEY|PASSWORD|SECRET|TOKEN/iu.test(key)
      || !['HOME', 'LANG', 'LC_ALL', 'PATH', 'TERM', 'TZ', 'NO_COLOR', 'PAGER', 'GIT_PAGER', 'DSH_HOME', 'DSH_SHELL', 'DSH_CALL_ID', 'DSH_OPERATION_ID', 'DSH_SESSION_ID'].includes(key)
      || value.includes('\0') || value.includes('\n') || value.includes('\r')) throw new Error(`development-vm: environment entry is not allowed: ${key}`)
    if (key === 'DSH_HOME' && value !== '/workspace/.dsh') throw new Error('development-vm: DSH_HOME must be /workspace/.dsh')
    result[key] = value
  }
  if (Object.keys(result).length === 0) throw new Error('development-vm: environment must be an explicit replacement')
  return result
}

export default DevelopmentVms
