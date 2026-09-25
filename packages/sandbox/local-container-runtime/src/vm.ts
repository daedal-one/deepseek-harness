/** Optional conversation VM provider; Git maintenance remains in the isolated host controller. @module */
import type { ConversationWorkspaceId } from './workspace-types.ts'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  IncusDevelopmentVms,
  incusCommand,
  parseDevelopmentVmReference,
  sameDevelopmentVmReference,
  type DevelopmentVmConfig,
  type DevelopmentVmReference,
} from './vm-engine.ts'
import { createVmProcess, connectVmPreview } from './vm-process.ts'
import type {
  LocalContainerProcessHandle,
  LocalContainerProcessRequest,
  PodmanControllerExecRequest,
  PodmanControllerExecResult,
  WorkspaceCheckpointRuntime,
  WorkspaceExecutionRuntime,
} from './types.ts'

/** Deployment-owned VM and process bounds. */
export interface Config extends DevelopmentVmConfig {
  /** Complete non-secret guest process environment. */
  environment: Record<string, string>
  /** Maximum simultaneous attached guest commands. */
  maxLiveProcesses: number
  /** Maximum active lifetime before the guest is stopped for recovery. */
  lifetimeMs: number
}

/** One prepared source workspace to attach to a development VM. */
export interface DevelopmentVmOpenRequest {
  /** Supervisor-derived workspace identity. */
  id: ConversationWorkspaceId
  /** Private memory-backed source directory. */
  directory: string
  /** Acknowledged source generation. */
  generation: number
  /** SHA-256 identity of the acknowledged source artifact. */
  checkpointHash: string
  /** Whether the acknowledged source still occupies its owned RAM slot. */
  retained: boolean
  /** Persisted provider identity, absent only while first attachment is pending. */
  reference?: DevelopmentVmReference
  /** Per-process current Git grant issuance. */
  authorize?: () => Promise<readonly string[]>
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
      || !Number.isSafeInteger(config.lifetimeMs) || config.lifetimeMs < 1 || config.lifetimeMs > 2_147_483_647) {
      throw new Error('development-vm: invalid process or lifetime bound')
    }
    environment(config.environment)
    ctx.effect(() => async () => {
      const results = await Promise.allSettled([...this.runtimes].map(runtime => runtime.dispose()))
      const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      if (failures.length > 0) throw new AggregateError(failures, 'development-vm: guest shutdown failed')
    }, 'development VM shutdown')
  }

  /** Complete provider identity persisted beside each paired source generation. */
  get identity(): DevelopmentVmReference { return parseDevelopmentVmReference(this.engine.reference) }

  async [Service.init](): Promise<void> { await this.engine.verifyNetwork() }

  /** Require a durable record to name this exact effective-profile provider.
   * @param reference - untrusted persisted VM identity.
   */
  assertReference(reference: unknown): void {
    if (!sameDevelopmentVmReference(reference, this.engine.reference)) {
      throw new Error('development-vm: persisted descriptor does not match the effective profile')
    }
  }

  /** Quiesce a retained guest before the workspace owner touches its RAM slot.
   * @param id - workspace identity derived by the trusted supervisor.
   * @param reference - persisted provider identity, when recovery already acknowledged a VM.
   */
  async recover(id: ConversationWorkspaceId, reference?: unknown): Promise<void> {
    if (reference !== undefined) this.assertReference(reference)
    await this.engine.verifyNetwork()
    if (await this.engine.exists(id)) {
      await this.engine.verifyIdentity(id)
      await this.engine.stop(id)
    }
  }

  /** Bind a prepared repository to its conversation's retained development VM.
   * @param base - isolated maintenance controller for the private source directory.
   * @param request - source generation, provider identity, and process authorization issuer.
   * @returns runtime and disposer; disposal retains durable guest storage.
   */
  async open(
    base: WorkspaceExecutionRuntime,
    request: DevelopmentVmOpenRequest,
  ): Promise<{ runtime: WorkspaceExecutionRuntime; dispose(): Promise<void> }> {
    const { id, directory, generation, checkpointHash, retained, reference, authorize } = request
    if (reference !== undefined) this.assertReference(reference)
    await this.engine.verifyNetwork()
    const exists = await this.engine.exists(id)
    if (reference !== undefined && !exists) throw new Error('development-vm: retained guest storage is missing; refusing a replacement')
    if (exists) {
      await this.engine.verifyIdentity(id)
      if (!retained) await this.engine.restore(id, generation, checkpointHash, directory)
      await this.engine.verify(id, directory)
    } else await this.engine.create(id, directory)
    const runtime = new VmWorkspace(this.engine, this.config, base, id, this.ctx, authorize)
    this.runtimes.add(runtime)
    try {
      await this.engine.start(id)
      if (reference === undefined) {
        await this.engine.freeze(id)
        await this.engine.checkpoint(id, generation, checkpointHash)
        await this.engine.unfreeze(id)
      }
      return {
        runtime,
        dispose: async () => {
          await runtime.dispose()
          this.runtimes.delete(runtime)
        },
      }
    } catch (error) {
      try { await runtime.dispose(); this.runtimes.delete(runtime) }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'development-vm: startup and shutdown failed') }
      throw error
    }
  }

  /** Expose paired snapshot operations for a stopped displaced workspace.
   * @param id - retained workspace identity.
   * @param reference - persisted exact provider identity.
   * @returns checkpoint operations that never start guest execution.
   */
  retention(id: ConversationWorkspaceId, reference: unknown): WorkspaceCheckpointRuntime {
    this.assertReference(reference)
    return {
      checkpoint: async (generation, checkpointHash) => {
        await this.engine.verifyNetwork()
        if (!await this.engine.exists(id)) throw new Error('development-vm: retained guest storage is missing')
        await this.engine.verifyIdentity(id)
        if (await this.engine.state(id) !== 'Stopped') throw new Error('development-vm: displaced checkpoint requires a stopped guest')
        await this.engine.checkpoint(id, generation, checkpointHash)
      },
      discardCheckpoint: async (generation, checkpointHash) => {
        await this.engine.verifyIdentity(id)
        await this.engine.discard(id, generation, checkpointHash)
      },
      pruneCheckpoints: async (generation) => {
        await this.engine.verifyIdentity(id)
        await this.engine.prune(id, generation)
      },
    }
  }
}

type ControllerRequest = PodmanControllerExecRequest & { readonly deadlineMs: number }

class VmWorkspace implements WorkspaceExecutionRuntime {
  readonly executionWorld: object
  readonly containerName: string
  private closed = false
  private barrier = false
  private disposal: Promise<void> | undefined
  private allocating = 0
  private readonly processes = new Set<LocalContainerProcessHandle>()
  private readonly controllers = new Set<Promise<unknown>>()
  private readonly allocations = new Set<Promise<unknown>>()
  private readonly timer: NodeJS.Timeout
  private readonly command: ReturnType<typeof incusCommand>

  constructor(
    private readonly engine: IncusDevelopmentVms,
    private readonly config: Config,
    private readonly base: WorkspaceExecutionRuntime,
    private readonly id: ConversationWorkspaceId,
    ctx: Context,
    private readonly authorize?: () => Promise<readonly string[]>,
  ) {
    this.executionWorld = base.executionWorld
    this.containerName = engine.name(id)
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
    const process = await this.allocate({ argv: request.argv as [string, ...string[]], cwd: '/workspace',
      environment: {}, tty: false, stdin: true, ...request.signal === undefined ? {} : { signal: request.signal } }, false)
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
          if ((channel !== 1 && channel !== 2) || pending[1] !== 0 || pending[2] !== 0 || pending[3] !== 0) {
            throw new Error('development-vm: invalid controller stream')
          }
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
    } catch (error) {
      try { await this.cancelProcesses() }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'development-vm: controller failure and shutdown failed') }
      throw error
    } finally { clearTimeout(timer) }
  }

  async createProcess(request: LocalContainerProcessRequest): Promise<LocalContainerProcessHandle> {
    if (this.closed) throw new Error('development-vm: workspace is being saved')
    const operation = this.allocate(request, true)
    this.allocations.add(operation)
    try { return await operation } finally { this.allocations.delete(operation) }
  }

  private async allocate(request: LocalContainerProcessRequest, git: boolean): Promise<LocalContainerProcessHandle> {
    if (this.processes.size + this.allocating >= this.config.maxLiveProcesses) throw new Error('development-vm: attached process limit reached')
    const replacement = environment({ ...this.config.environment, ...request.environment })
    request.signal?.throwIfAborted()
    this.allocating++
    try {
      const authorization = git && this.authorize !== undefined ? await this.authorize() : []
      request.signal?.throwIfAborted()
      const handle = await createVmProcess(this.config, this.containerName, { ...request, environment: replacement }, this.command, authorization)
      const terminate = handle.terminate.bind(handle)
      handle.terminate = async () => {
        try { await terminate() }
        catch (error) {
          this.closed = true
          try { await this.engine.stop(this.id) }
          catch (cleanup) { throw new AggregateError([error, cleanup], 'development-vm: process removal and guest shutdown failed') }
          throw error
        }
      }
      this.processes.add(handle)
      void handle.done.finally(() => this.processes.delete(handle)).catch(() => undefined)
      return handle
    } catch (error) {
      this.closed = true
      try { await this.engine.stop(this.id) }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'development-vm: process allocation and guest shutdown failed') }
      throw error
    } finally { this.allocating-- }
  }

  async settle<T>(
    timeoutMs: number,
    operation: (control: (request: ControllerRequest) => Promise<PodmanControllerExecResult>) => Promise<T>,
    quiesce?: () => Promise<void>,
  ): Promise<T> {
    this.closed = true
    await quiesce?.()
    let deadline: NodeJS.Timeout | undefined
    try {
      await Promise.race([Promise.all([...this.allocations, ...this.controllers]), new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => { reject(new Error('development-vm: attached controller did not settle')) }, timeoutMs)
      })])
    } finally { if (deadline !== undefined) clearTimeout(deadline) }
    const state = await this.engine.state(this.id)
    if (state === 'Running') {
      await this.engine.freeze(this.id)
      this.barrier = true
    } else if (state === 'Frozen') {
      if (!this.barrier) throw new Error('development-vm: frozen guest is not owned by this maintenance barrier')
    } else if (state !== 'Stopped') throw new Error('development-vm: cannot establish workspace barrier')
    const result = await this.base.settle(timeoutMs, operation)
    if (state !== 'Stopped') {
      await this.engine.unfreeze(this.id)
      this.barrier = false
      this.closed = false
    }
    return result
  }

  async checkpoint(generation: number, checkpointHash: string): Promise<void> {
    await this.engine.checkpoint(this.id, generation, checkpointHash)
  }

  async discardCheckpoint(generation: number, checkpointHash: string): Promise<void> {
    await this.engine.discard(this.id, generation, checkpointHash)
  }

  async pruneCheckpoints(generation: number): Promise<void> { await this.engine.prune(this.id, generation) }

  async cancelProcesses(): Promise<void> {
    this.closed = true
    await Promise.allSettled([...this.allocations])
    const results = await Promise.allSettled([this.engine.stop(this.id), this.base.cancelProcesses()])
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (failures.length === 0) {
      let timer: NodeJS.Timeout | undefined
      try {
        await Promise.race([Promise.all([...this.processes].map(process => process.done)), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { reject(new Error('development-vm: attached process shutdown did not settle')) }, this.config.timeoutMs)
        })])
      } finally { if (timer !== undefined) clearTimeout(timer) }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'development-vm: guest shutdown failed')
  }

  async connectPreview(port: number): Promise<import('node:stream').Duplex> {
    if (this.closed) throw new Error('development-vm: workspace is being saved')
    return await connectVmPreview(this.config, this.containerName, port)
  }

  async dispose(): Promise<void> {
    clearTimeout(this.timer)
    await (this.disposal ??= this.cancelProcesses())
  }
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
