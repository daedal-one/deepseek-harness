/**
 * Process-owned rootless Podman runtime owner. It creates exactly one verified
 * disposable container through Podman's Docker-compatible Unix-socket API and
 * removes that container with its private `/tmp` backing directory.
 * @module @deepseek-ai/dsh-local-container-runtime
 */

import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { chmod, lstat, mkdtemp, readlink, rm, unlink } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import type { Duplex } from 'node:stream'
import { finished } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DockerodePodmanEngine } from './engine.ts'
import type {
  LocalContainerDiagnostics,
  LocalContainerHandle,
  LocalContainerProcessHandle,
  LocalContainerProcessRequest,
  LocalContainerRuntimeConfig,
  PodmanContainer,
  PodmanContainerCreate,
  PodmanContainerInspect,
  PodmanControllerExecRequest,
  PodmanControllerExecResult,
  PodmanEngine,
  PodmanInfo,
} from './types.ts'

export type {
  WorkspaceExecutionRuntime,
  LocalContainerDiagnostics,
  LocalContainerHandle,
  LocalContainerProcessHandle,
  LocalContainerProcessRequest,
  LocalContainerRuntimeConfig,
  PodmanContainer,
  PodmanContainerCreate,
  PodmanContainerInspect,
  PodmanControllerExecRequest,
  PodmanControllerExecResult,
  PodmanEngine,
  PodmanImageInspect,
  PodmanInfo,
  PodmanMountInspect,
} from './types.ts'

/** Canonical writable path shared by filesystem and subprocess adapters. */
export const WORKSPACE_PATH = '/workspace' as const

const TMP_PATH = '/tmp'
const BACKING_DIRECTORY_PREFIX = `${TMP_PATH}/dsh-local-container-runtime-`
const MAX_TIMER_DELAY_MS = 2_147_483_647
const CONTROL_OUTPUT_MAX_BYTES = 4096
const DIGEST_PINNED_IMAGE = /@sha256:[a-f0-9]{64}$/u
const ROOT_USER = /^(?:root|0)(?::|$)/iu
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/u
const SENSITIVE_ENVIRONMENT_NAME = /KEY|PASSWORD|SECRET|TOKEN/iu
const ALLOWED_ENVIRONMENT_NAMES = new Set([
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'TERM',
  'TZ',
  'NO_COLOR',
  'PAGER',
  'GIT_PAGER',
  'DSH_HOME',
  'DSH_SHELL',
  'DSH_CALL_ID',
  'DSH_OPERATION_ID',
  'DSH_SESSION_ID',
])
const RUNTIME_ENTRYPOINT = ['/usr/bin/env']
const USERNS_MODE = 'keep-id:uid=1000,gid=1000'

interface ResolvedConfig {
  socketPath: string
  manageService: boolean
  podmanCommand: string | undefined
  serviceStartupTimeoutMs: number
  image: string
  user: string
  environment: string[]
  memoryBytes: number
  nanoCpus: number
  pidsLimit: number
  tmpfsBytes: number
  engineRequestTimeoutMs: number
  maxLiveProcesses: number
  lifetimeMs: number
  stopTimeoutSeconds: number
}

interface CleanupState {
  containerRemoved: boolean
  backingDirectoryRemoved: boolean
}

/** A caller cancellation stopped the whole container to settle its controller process. */
export class LocalContainerControllerAborted extends Error {
  constructor() {
    super('local-container-runtime: controller operation aborted')
  }
}

/** The per-operation controller deadline stopped the whole container to settle its process. */
export class LocalContainerControllerDeadlineExceeded extends Error {
  constructor() {
    super('local-container-runtime: controller operation exceeded its deadline')
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Release idle managed processes before capturing a workspace with mutation admission closed.
     * @param payload.executionWorld - exact world whose process owners must drain.
     * @mode serial
     */
    'workspace/quiesce'(payload: { executionWorld: object }): Promise<void> | void
  }
  interface Context {
    localContainerRuntime: LocalContainerRuntime
  }
}

/**
 * Owns one disposable rootless Podman container. Provider adapters await
 * {@link getContainer}; it resolves only after engine, image, created-container,
 * and started-container inspection prove the configured controls.
 */
export class LocalContainerRuntime extends Service {
  static Config: z<LocalContainerRuntimeConfig> = z.object({
    socketPath: z.string().required(),
    manageService: z.boolean().required(),
    podmanCommand: z.string(),
    serviceStartupTimeoutMs: z.natural().required(),
    image: z.string().required(),
    user: z.string().required(),
    environment: z.dict(z.string()).required(),
    memoryBytes: z.natural().required(),
    nanoCpus: z.natural().required(),
    pidsLimit: z.natural().required(),
    tmpfsBytes: z.natural().required(),
    engineRequestTimeoutMs: z.natural().required(),
    maxLiveProcesses: z.natural().required(),
    lifetimeMs: z.natural().required(),
    stopTimeoutSeconds: z.natural().required(),
  })

  /** Opaque stable identity shared by every provider mounted in this world. */
  readonly executionWorld: object = Object.freeze({})
  /** Fixed canonical working directory for every adapter in this world. */
  readonly workspacePath: '/workspace' = WORKSPACE_PATH
  /** Random retained Engine name, safe to use in host-side diagnostics. */
  readonly containerName: string = `dsh-local-container-${randomUUID()}`

  private readonly config: ResolvedConfig
  private readonly rawConfig: LocalContainerRuntimeConfig
  private admissionClosed = false
  private readonly controllers = new Set<Promise<unknown>>()
  private readonly ready: Promise<LocalContainerHandle>
  private readonly cleanupState: CleanupState = { containerRemoved: false, backingDirectoryRemoved: false }
  private cleanup: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private lifetimeTimer: NodeJS.Timeout | undefined
  private disposing = false
  private engine: PodmanEngine | undefined
  private engineService: ChildProcess | undefined
  private engineServiceError: unknown
  private container: PodmanContainer | undefined
  private containerId: string | undefined
  private readonly processes = new Set<OwnedProcessContainer>()
  private processAllocation: Promise<void> = Promise.resolve()
  private imageId: string | undefined
  private backingDirectory: string | undefined

  constructor(ctx: Context, config: LocalContainerRuntimeConfig, private readonly retainedDirectory?: string) {
    super(ctx, 'localContainerRuntime')
    this.rawConfig = config
    this.config = this.resolveConfig(config)
    this.ready = Promise.resolve().then(() => this.open())
    this.armLifetime()
    ctx.effect(() => async () => {
      await this.close()
    }, 'local container runtime teardown')
  }

  /**
   * Return the verified running container identity for provider adapters.
   * @returns the owner-retained Engine id and fixed workspace path.
   * @throws when engine verification, setup, or teardown prevents readiness.
   */
  async getContainer(): Promise<LocalContainerHandle> {
    if (this.disposing) throw new Error('local-container-runtime: runtime is disposing')
    const handle = await this.ready
    this.throwIfDisposing()
    return handle
  }

  /**
   * Execute one owner-controlled provider controller in the verified container.
   * Caller cancellation or deadline expiry tears down the whole execution world,
   * because the Podman exec API cannot prove that it stopped one exec process.
   * @param request - bounded command, input, deadline, output limit, and cancellation signal.
   * @returns settled bounded standard streams and exit code.
   */
  async executeController(request: PodmanControllerExecRequest & { readonly deadlineMs: number }): Promise<PodmanControllerExecResult> {
    if (this.admissionClosed) throw new Error('local-container-runtime: workspace is being saved')
    const operation = this.runController(request)
    this.controllers.add(operation)
    try { return await operation } finally { this.controllers.delete(operation) }
  }

  private async runController(request: PodmanControllerExecRequest & { readonly deadlineMs: number }): Promise<PodmanControllerExecResult> {
    if (request.argv.length === 0) throw new Error('local-container-runtime: controller argv must not be empty')
    positiveSafeInteger('controller maxOutputBytes', request.maxOutputBytes)
    positiveSafeInteger('controller deadlineMs', request.deadlineMs, MAX_TIMER_DELAY_MS)
    if (request.signal?.aborted === true) throw new LocalContainerControllerAborted()

    const controller = new AbortController()
    let cancellation: 'aborted' | 'deadline' | undefined
    const abortFromCaller = (): void => {
      cancellation = 'aborted'
      controller.abort()
    }
    request.signal?.addEventListener('abort', abortFromCaller, { once: true })
    const deadline = setTimeout(() => {
      cancellation = 'deadline'
      controller.abort()
    }, request.deadlineMs)
    const stopped = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => {
        void this.close().then(
          () =>{  reject(cancellation === 'deadline'
            ? new LocalContainerControllerDeadlineExceeded()
            : new LocalContainerControllerAborted()) },
          (error: unknown) =>{  reject(new Error('local-container-runtime: controller cancellation cleanup failed', { cause: error })) },
        )
      }, { once: true })
    })

    try {
      const running = this.getContainer().then(async () => {
        const container = this.container
        if (container === undefined) throw new Error('local-container-runtime: verified container is unavailable')
        return await container.runController({
          argv: request.argv,
          stdin: request.stdin,
          maxOutputBytes: request.maxOutputBytes,
          signal: controller.signal,
        })
      })
      const settled = running.catch(async (error: unknown) => {
        if (controller.signal.aborted) return await stopped
        try {
          await this.close()
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'local-container-runtime: controller failed and cleanup failed')
        }
        throw error
      })
      const result = await Promise.race([settled, stopped])
      if (controller.signal.aborted) return await stopped
      return result
    } finally {
      clearTimeout(deadline)
      request.signal?.removeEventListener('abort', abortFromCaller)
    }
  }

  /**
   * Create one independently removable process container in this execution world.
   * @param request - exact process, environment, terminal, and allocation cancellation facts.
   * @returns an attached started handle whose removal proves descendant quiescence.
   */
  async createProcess(request: LocalContainerProcessRequest): Promise<LocalContainerProcessHandle> {
    if (this.admissionClosed) throw new Error('local-container-runtime: workspace is being saved')
    this.validateProcessRequest(request)
    request.signal?.throwIfAborted()
    const prior = this.processAllocation
    const turn = Promise.withResolvers<void>()
    this.processAllocation = prior.then(() => turn.promise, () => turn.promise)
    await prior
    try {
      this.throwIfDisposing()
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- admission can close while process allocation is awaited
      if (this.admissionClosed) throw new Error('local-container-runtime: workspace is being saved')
      if (this.processes.size >= this.config.maxLiveProcesses) {
        throw new Error(`local-container-runtime: process-container limit ${this.config.maxLiveProcesses} reached`)
      }
      await this.getContainer()
      request.signal?.throwIfAborted()
      return await this.openProcess(request)
    } finally {
      turn.resolve()
    }
  }

  /**
   * Bind a separately owned workspace to a new isolated world on the same engine.
   * @param directory - trusted supervisor-owned private backing directory.
   * @returns the verified world and its quiescent container disposer; storage is retained.
   */
  async createWorkspace(directory: string): Promise<{ runtime: LocalContainerRuntime; dispose(): Promise<void> }> {
    await this.getContainer()
    if (!isAbsolute(directory) || directory.includes(':')) throw new Error('local-container-runtime: invalid workspace directory')
    const metadata = await lstat(directory)
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0
      || metadata.uid !== process.getuid?.()) throw new Error('local-container-runtime: workspace must be an owner-only real directory')
    const context = new Context()
    const runtime = new LocalContainerRuntime(context, { ...this.rawConfig, manageService: false }, directory)
    try { await runtime.getContainer() }
    catch (error) {
      try { await context.fiber.dispose() }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'workspace world preparation and cleanup failed') }
      throw error
    }
    return { runtime, dispose: () => context.fiber.dispose() }
  }

  /**
   * Revoke new writes and wait for all existing processes and controllers before capture.
   * @param timeoutMs - bounded wait for existing writers; expiry leaves them running.
   * @param operation - trusted capture operation with exclusive controller access.
   * @param quiesce - release managed idle processes before waiting for all writers.
   * @returns the capture result, with admission restored only after successful settlement.
   */
  async settle<T>(
    timeoutMs: number,
    operation: (control: (
      request: PodmanControllerExecRequest & { readonly deadlineMs: number },
    ) => Promise<PodmanControllerExecResult>) => Promise<T>,
    quiesce?: () => Promise<void>,
  ): Promise<T> {
    positiveSafeInteger('settlement timeout', timeoutMs, MAX_TIMER_DELAY_MS)
    this.admissionClosed = true
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        (async () => {
          await quiesce?.()
          await this.processAllocation
          await Promise.all([...this.controllers])
          await Promise.all([...this.processes].map(process => process.waitForRemoval()))
        })(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() =>{  reject(new Error('workspace save pending: active writers did not stop before the deadline')) }, timeoutMs) }),
      ])
      const result = await operation(request => this.runController(request))
      this.admissionClosed = false
      return result
    } finally { if (timer !== undefined) clearTimeout(timer) }
  }

  /** Stop every owned subprocess before cancellation or shutdown recovery capture. */
  async cancelProcesses(): Promise<void> {
    this.admissionClosed = true
    await this.processAllocation
    await Promise.all([...this.processes].map(process => process.terminate()))
  }

  /** Stop stale process owners before restoring a supervisor-owned directory.
   * @param directory - exact private bind source whose storage must be quiescent.
   */
  async recoverWorkspace(directory: string): Promise<void> {
    await this.getContainer()
    if (this.engine === undefined) throw new Error('local-container-runtime: engine unavailable')
    const containers = await this.engine.containersUsing(directory)
    await Promise.all(containers.map(container => removeContainer(container, this.config.stopTimeoutSeconds)))
  }

  /** Retained Engine identifiers without exposing the private host backing path. */
  get diagnostics(): LocalContainerDiagnostics {
    return { containerName: this.containerName, containerId: this.containerId }
  }

  /**
   * Create the Docker-compatible API client for the explicitly configured Unix socket.
   * @param socketPath - rootless Podman Unix socket path.
   * @param timeoutMs - upper bound for each Engine API request during this owner lifetime.
   * @returns the Engine API adapter used by the setup transaction.
   */
  protected createEngine(socketPath: string, timeoutMs: number): PodmanEngine {
    return new DockerodePodmanEngine(socketPath, timeoutMs)
  }

  /** Start the setup transaction and retain only a fully inspected running world. */
  private async open(): Promise<LocalContainerHandle> {
    try {
      const engine = this.createEngine(this.config.socketPath, this.config.engineRequestTimeoutMs)
      this.engine = engine
      const info = this.config.manageService ? await this.startManagedService(engine) : await engine.info()
      this.verifyEngine(info)
      const image = await engine.inspectImage(this.config.image)
      if (image.Id === undefined || !/^sha256:[a-f0-9]{64}$/u.test(image.Id)) {
        throw new Error('local-container-runtime: Engine image inspection omitted a content identity')
      }
      this.imageId = image.Id
      if (image.Config?.Volumes !== undefined && image.Config.Volumes !== null && Object.keys(image.Config.Volumes).length > 0) {
        throw new Error('local-container-runtime: image declares VOLUME entries and is rejected')
      }
      this.backingDirectory = this.retainedDirectory ?? await this.createBackingDirectory()
      this.throwIfDisposing()
      let container: PodmanContainer
      try {
        container = await engine.createContainer(this.createRequest(this.backingDirectory))
      } catch (createFailure) {
        const recovered = engine.getContainer(this.containerName)
        try {
          const inspection = await recovered.inspect()
          this.container = recovered
          this.containerId = inspection.Id ?? recovered.id
        } catch (recoveryFailure) {
          if (!isMissingContainer(recoveryFailure)) {
            throw new AggregateError([createFailure, recoveryFailure], 'local-container-runtime: create failed and named-container recovery failed')
          }
        }
        throw createFailure
      }
      if (container.id.length === 0) throw new Error('local-container-runtime: Engine created a container without an id')
      this.container = container
      this.containerId = container.id
      this.verifyContainer(await container.inspect(), false)
      this.throwIfDisposing()
      await container.start()
      this.verifyContainer(await container.inspect(), true)
      await this.verifyEffectiveResourceLimits(container)
      this.throwIfDisposing()
      return { id: container.id, workspacePath: WORKSPACE_PATH }
    } catch (error) {
      try {
        await this.cleanupOwnedResources()
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'local-container-runtime: setup failed and rollback failed')
      }
      throw error
    }
  }

  private async startManagedService(engine: PodmanEngine): Promise<PodmanInfo> {
    const command = this.config.podmanCommand
    if (command === undefined) throw new Error('local-container-runtime: podmanCommand is required when manageService is true')
    try {
      await lstat(this.config.socketPath)
      throw new Error('local-container-runtime: managed service socket path already exists')
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    this.engineService = spawn(command, ['system', 'service', '--time=0', `unix://${this.config.socketPath}`], {
      stdio: 'ignore',
      env: {
        ...(process.env.HOME === undefined ? {} : { HOME: process.env.HOME }),
        ...(process.env.PATH === undefined ? {} : { PATH: process.env.PATH }),
        ...(process.env.XDG_RUNTIME_DIR === undefined ? {} : { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR }),
      },
    })
    this.engineService.once('error', (error: unknown) => { this.engineServiceError = error })
    const deadline = Date.now() + this.config.serviceStartupTimeoutMs
    let lastFailure: unknown
    while (Date.now() < deadline) {
      if (this.engineServiceError !== undefined) throw new Error('local-container-runtime: managed Podman service failed to start', { cause: this.engineServiceError })
      if (this.engineService.exitCode !== null) {
        throw new Error(`local-container-runtime: managed Podman service exited during startup (${this.engineService.exitCode})`)
      }
      try {
        return await engine.info()
      } catch (error) {
        lastFailure = error
      }
      await delay(50)
    }
    throw new Error('local-container-runtime: managed Podman service did not become ready before its deadline', { cause: lastFailure })
  }

  private async stopManagedService(): Promise<void> {
    const service = this.engineService
    if (service === undefined) return
    if (service.exitCode === null && service.signalCode === null) {
      service.kill('SIGTERM')
      const exited = new Promise<void>((resolve) => {
        service.once('exit', () =>{  resolve() })
        if (service.exitCode !== null || service.signalCode !== null) resolve()
      })
      const graceful = await Promise.race([
        exited.then(() => true),
        delay(this.config.stopTimeoutSeconds * 1000).then(() => false),
      ])
      if (!graceful) {
        service.kill('SIGKILL')
        await exited
      }
    }
    try {
      const metadata = await lstat(this.config.socketPath)
      if (metadata.isSocket()) await unlink(this.config.socketPath)
      else throw new Error('local-container-runtime: managed service socket path changed type')
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    this.engineService = undefined
  }

  private async openProcess(request: LocalContainerProcessRequest): Promise<LocalContainerProcessHandle> {
    const engine = this.engine
    const backingDirectory = this.backingDirectory
    const imageId = this.imageId
    if (engine === undefined || backingDirectory === undefined || imageId === undefined) {
      throw new Error('local-container-runtime: verified process-container inputs are unavailable')
    }
    const name = `dsh-local-container-process-${randomUUID()}`
    const environment = this.processEnvironment(request.environment)
    const createRequest: PodmanContainerCreate = {
      name,
      Image: this.config.image,
      Entrypoint: [...RUNTIME_ENTRYPOINT],
      Cmd: ['-i', ...environment, ...request.argv],
      User: this.config.user,
      WorkingDir: request.cwd,
      Env: [],
      ReadonlyRootfs: true,
      NetworkDisabled: true,
      AttachStdin: request.stdin,
      AttachStdout: true,
      AttachStderr: true,
      OpenStdin: request.stdin,
      StdinOnce: false,
      Tty: request.tty,
      HostConfig: {
        ...this.hostConfig(backingDirectory),
        ...request.tty && request.rows !== undefined && request.cols !== undefined
          ? { ConsoleSize: [request.rows, request.cols] as [number, number] }
          : {},
      },
    }
    let container: PodmanContainer | undefined
    let owned: OwnedProcessContainer | undefined
    try {
      try {
        container = await engine.createContainer(createRequest)
      } catch (createFailure) {
        const recovered = engine.getContainer(name)
        try {
          await recovered.inspect()
          container = recovered
        } catch (recoveryFailure) {
          if (!isMissingContainer(recoveryFailure)) {
            throw new AggregateError([createFailure, recoveryFailure], 'local-container-runtime: process create failed and recovery failed')
          }
        }
        if (container === undefined) throw createFailure
      }
      this.verifyProcessContainer(await container.inspect(), createRequest, imageId, backingDirectory, false)
      const stream = await container.attach({ stdin: request.stdin, stdout: true, stderr: true })
      request.signal?.throwIfAborted()
      await container.start()
      const running = await container.inspect()
      if (running.State?.Running === true) {
        this.verifyProcessContainer(running, createRequest, imageId, backingDirectory, true)
      }
      owned = new OwnedProcessContainer(container, stream, request.tty, this.config.stopTimeoutSeconds, () => {
        if (owned !== undefined) this.processes.delete(owned)
      })
      this.processes.add(owned)
      request.signal?.throwIfAborted()
      return owned
    } catch (error) {
      if (owned !== undefined) this.processes.delete(owned)
      if (container !== undefined) {
        try {
          await removeContainer(container, this.config.stopTimeoutSeconds)
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'local-container-runtime: process setup failed and rollback failed')
        }
      }
      throw error
    }
  }

  private verifyProcessContainer(
    inspect: PodmanContainerInspect,
    request: PodmanContainerCreate,
    imageId: string,
    backingDirectory: string,
    requireRunning: boolean,
  ): void {
    const host = inspect.HostConfig
    const config = inspect.Config
    const workspace = inspect.Mounts?.find(mount => mount.Destination === WORKSPACE_PATH)
    if (inspect.Image !== imageId || host === undefined || config === undefined) {
      throw new Error('local-container-runtime: process-container inspection omitted verified identity')
    }
    const entrypoint = typeof config.Entrypoint === 'string' ? [config.Entrypoint] : config.Entrypoint
    if (config.User !== request.User || config.WorkingDir !== request.WorkingDir
      || !sameValues(entrypoint, request.Entrypoint) || !sameValues(config.Cmd, request.Cmd)) {
      throw new Error(`local-container-runtime: Engine changed process-container execution facts (${JSON.stringify({ user: config.User === request.User, cwd: config.WorkingDir === request.WorkingDir, entrypoint: sameValues(entrypoint, request.Entrypoint), command: sameValues(config.Cmd, request.Cmd) })})`)
    }
    if (host.ReadonlyRootfs !== true || host.NetworkMode !== 'none' || host.Privileged === true
      || host.PidMode === 'host' || host.IpcMode === 'host' || (host.Devices?.length ?? 0) > 0) {
      throw new Error('local-container-runtime: process-container isolation controls differ from the verified template')
    }
    if (inspect.Mounts?.length !== 1 || workspace?.Type !== 'bind'
      || workspace.Source !== backingDirectory || workspace.RW !== true) {
      throw new Error('local-container-runtime: process container exposed an unexpected persistent mount')
    }
    if (requireRunning && inspect.State?.Running !== true) {
      throw new Error('local-container-runtime: process container did not start')
    }
  }

  private processEnvironment(overrides: Readonly<Record<string, string | undefined>>): string[] {
    const environment = new Map(this.config.environment.map((entry) => {
      const separator = entry.indexOf('=')
      return [entry.slice(0, separator), entry.slice(separator + 1)] as const
    }))
    for (const [name, value] of Object.entries(overrides)) {
      if (!ALLOWED_ENVIRONMENT_NAMES.has(name) || SENSITIVE_ENVIRONMENT_NAME.test(name)
        || !ENVIRONMENT_NAME.test(name) || name.includes('\0') || value?.includes('\0') === true) {
        throw new Error(`local-container-runtime: process environment entry is invalid: ${name}`)
      }
      if (name === 'DSH_HOME' && value !== undefined && value !== `${WORKSPACE_PATH}/.dsh`) {
        throw new Error('local-container-runtime: DSH_HOME must refer to /workspace/.dsh')
      }
      if (value === undefined) environment.delete(name)
      else environment.set(name, value)
    }
    return [...environment].sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => `${name}=${value}`)
  }

  private validateProcessRequest(request: LocalContainerProcessRequest): void {
    if (request.argv.length === 0 || request.argv.some(value => value.length === 0 || value.includes('\0'))) {
      throw new Error('local-container-runtime: process argv must contain non-empty values without null bytes')
    }
    if (request.cwd !== WORKSPACE_PATH && (!request.cwd.startsWith(`${WORKSPACE_PATH}/`)
      || request.cwd.split('/').some(part => part === '..' || part === '.'))) {
      throw new Error('local-container-runtime: process cwd must be a normalized /workspace path')
    }
    if (request.tty) {
      positiveSafeInteger('process terminal rows', request.rows ?? 0)
      positiveSafeInteger('process terminal columns', request.cols ?? 0)
    }
  }

  private hostConfig(backingDirectory: string): PodmanContainerCreate['HostConfig'] {
    return {
      NetworkMode: 'none',
      UsernsMode: USERNS_MODE,
      PidMode: 'private',
      IpcMode: 'private',
      Privileged: false,
      Devices: [],
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      Tmpfs: { '/tmp': `rw,nosuid,nodev,noexec,size=${this.config.tmpfsBytes},mode=1777` },
      Binds: [`${backingDirectory}:${WORKSPACE_PATH}:rw,rprivate,nosuid,nodev${this.retainedDirectory === undefined ? ',noexec' : ''}`],
      Memory: this.config.memoryBytes,
      MemorySwap: this.config.memoryBytes,
      NanoCpus: this.config.nanoCpus,
      PidsLimit: this.config.pidsLimit,
    }
  }

  /** Build the fixed Docker-compatible API request. */
  private createRequest(backingDirectory: string): PodmanContainerCreate {
    return {
      name: this.containerName,
      Image: this.config.image,
      Entrypoint: [...RUNTIME_ENTRYPOINT],
      Cmd: ['-i', ...this.config.environment, '/usr/bin/sleep', 'infinity'],
      User: this.config.user,
      WorkingDir: WORKSPACE_PATH,
      Env: [],
      ReadonlyRootfs: true,
      NetworkDisabled: true,
      HostConfig: this.hostConfig(backingDirectory),
    }
  }

  /** Reject an Engine that cannot enforce rootless systemd cgroup-v2 resource controls. */
  private verifyEngine(info: PodmanInfo): void {
    const cgroupVersion = info.CgroupVersion?.toLowerCase()
    if (info.Rootless !== true) throw new Error('local-container-runtime: Podman Engine API must report Rootless: true')
    if (cgroupVersion !== '2' && cgroupVersion !== 'v2') {
      throw new Error('local-container-runtime: Podman Engine API must report cgroup v2')
    }
    if (info.CgroupDriver?.toLowerCase() !== 'systemd') {
      throw new Error('local-container-runtime: Podman Engine API must report the systemd cgroup driver')
    }
    if (info.MemoryLimit !== true || info.PidsLimit !== true) {
      throw new Error('local-container-runtime: Podman Engine API must report memory and PID limit support')
    }
  }

  /** Verify the Engine's created or running container state against every owned control. */
  private verifyContainer(inspect: PodmanContainerInspect, requireRunning: boolean): void {
    const hostConfig = inspect.HostConfig
    const containerConfig = inspect.Config
    const backingDirectory = this.backingDirectory
    if (hostConfig === undefined || containerConfig === undefined || backingDirectory === undefined) {
      throw new Error('local-container-runtime: Engine inspection omitted required configuration')
    }
    if (this.imageId === undefined || inspect.Image !== this.imageId) {
      throw new Error('local-container-runtime: Engine container image differs from the inspected digest-pinned image')
    }
    if (containerConfig.User !== this.config.user) throw new Error('local-container-runtime: Engine changed the configured container user')
    if (containerConfig.WorkingDir !== WORKSPACE_PATH) throw new Error('local-container-runtime: Engine changed the fixed working directory')
    const entrypoint = typeof containerConfig.Entrypoint === 'string'
      ? [containerConfig.Entrypoint]
      : containerConfig.Entrypoint
    const expectedCommand = ['-i', ...this.config.environment, '/usr/bin/sleep', 'infinity']
    if (!sameValues(entrypoint, RUNTIME_ENTRYPOINT) || !sameValues(containerConfig.Cmd, expectedCommand)) {
      throw new Error('local-container-runtime: Engine did not replace image process defaults')
    }
    if (hostConfig.ReadonlyRootfs !== true) throw new Error('local-container-runtime: Engine did not enable a read-only root filesystem')
    if (hostConfig.NetworkMode !== 'none') throw new Error('local-container-runtime: Engine did not disable container networking')
    if (hostConfig.Privileged === true || hostConfig.PidMode === 'host' || hostConfig.IpcMode === 'host'
      || (hostConfig.Devices?.length ?? 0) > 0) {
      throw new Error('local-container-runtime: Engine inspection reported privileged, host-namespace, or device access')
    }
    const mounts = inspect.Mounts
    const workspace = mounts?.find(mount => mount.Destination === WORKSPACE_PATH)
    if (mounts === undefined || mounts.length !== 1
      || workspace?.Type !== 'bind' || workspace.Source !== backingDirectory || workspace.RW !== true) {
      throw new Error('local-container-runtime: Engine inspection exposed a persistent mount other than the private workspace')
    }
    if (requireRunning && inspect.State?.Running !== true) {
      throw new Error('local-container-runtime: Engine did not start the verified runtime container')
    }
  }

  /** Prove effective namespace, privilege, environment, mount, and cgroup controls from the started container. */
  private async verifyEffectiveResourceLimits(container: PodmanContainer): Promise<void> {
    const [hostPidNamespace, hostIpcNamespace] = await Promise.all([
      readlink('/proc/self/ns/pid'),
      readlink('/proc/self/ns/ipc'),
    ])
    const script = [
      'set -eu',
      'printf "memory="; cat /sys/fs/cgroup/memory.max',
      'printf "swap="; cat /sys/fs/cgroup/memory.swap.max',
      'printf "pids="; cat /sys/fs/cgroup/pids.max',
      'printf "cpu="; cat /sys/fs/cgroup/cpu.max',
      'printf "uid="; id -u',
      'printf "gid="; id -g',
      'printf "capeff="; sed -n "s/^CapEff:[[:space:]]*//p" /proc/self/status',
      'printf "nnp="; sed -n "s/^NoNewPrivs:[[:space:]]*//p" /proc/self/status',
      'printf "pidns="; readlink /proc/self/ns/pid',
      'printf "ipcns="; readlink /proc/self/ns/ipc',
      'printf "tmpfstype="; findmnt -n -o FSTYPE /tmp',
      'printf "tmpfsbytes="; df -B1 --output=size /tmp | tail -n 1 | tr -d " "',
      'printf "netifs="; find /sys/class/net -mindepth 1 -maxdepth 1 -printf "%f\\n" | sort | tr "\\n" ","; echo',
      'if touch /usr/.dsh-write-probe 2>/dev/null; then rm -f /usr/.dsh-write-probe; echo rootwrite=1; else echo rootwrite=0; fi',
      'if touch /workspace/.dsh-write-probe; then rm -f /workspace/.dsh-write-probe; echo workspacewrite=1; else echo workspacewrite=0; fi',
      'printf "pid1env="; base64 -w0 /proc/1/environ; echo',
    ].join('\n')
    const result = await container.runControl(['/bin/sh', '-c', script], CONTROL_OUTPUT_MAX_BYTES)
    if (result.exitCode !== 0) throw new Error('local-container-runtime: effective-control inspection command failed')
    const values = new Map(result.output.trim().split(/\r?\n/u).map((line) => {
      const separator = line.indexOf('=')
      return separator < 1 ? ['', ''] : [line.slice(0, separator), line.slice(separator + 1)]
    }))
    if (values.get('uid') !== '1000' || values.get('gid') !== '1000') {
      throw new Error('local-container-runtime: configured image user must resolve to uid and gid 1000')
    }
    if (values.get('capeff') !== '0000000000000000' || values.get('nnp') !== '1') {
      throw new Error('local-container-runtime: effective capability or no-new-privileges state is unsafe')
    }
    if (values.get('pidns') === hostPidNamespace || values.get('ipcns') === hostIpcNamespace) {
      throw new Error('local-container-runtime: container shares a host process or IPC namespace')
    }
    const tmpfsBytes = Number(values.get('tmpfsbytes'))
    if (values.get('tmpfstype') !== 'tmpfs' || !Number.isSafeInteger(tmpfsBytes)
      || tmpfsBytes < 1 || tmpfsBytes > this.config.tmpfsBytes) {
      throw new Error('local-container-runtime: effective /tmp mount is not the configured bounded tmpfs')
    }
    if (values.get('netifs') !== 'lo,' || values.get('rootwrite') !== '0'
      || values.get('workspacewrite') !== '1') {
      throw new Error(`local-container-runtime: effective network, root, or workspace control is unsafe (${JSON.stringify({ netifs: values.get('netifs'), rootwrite: values.get('rootwrite'), workspacewrite: values.get('workspacewrite') })})`)
    }
    const expectedEnvironment = Buffer.from(`${this.config.environment.join('\0')}\0`, 'utf8').toString('base64')
    if (values.get('pid1env') !== expectedEnvironment) {
      throw new Error('local-container-runtime: runtime process environment is not the configured replacement')
    }
    if (values.get('memory') !== String(this.config.memoryBytes)
      || values.get('swap') !== '0'
      || values.get('pids') !== String(this.config.pidsLimit)) {
      throw new Error('local-container-runtime: effective memory, swap, or PID cgroup limit differs from configuration')
    }
    const cpu = values.get('cpu')?.trim().split(/\s+/u)
    const quota = Number(cpu?.[0])
    const period = Number(cpu?.[1])
    const requestedRatio = this.config.nanoCpus / 1_000_000_000
    if (!Number.isFinite(quota) || !Number.isFinite(period) || period <= 0
      || Math.abs(quota / period - requestedRatio) > 0.001) {
      throw new Error('local-container-runtime: effective CPU cgroup limit differs from configuration')
    }
  }

  /** Create and verify one random mode-0700 directory strictly below `/tmp`. */
  private async createBackingDirectory(): Promise<string> {
    const directory = await mkdtemp(BACKING_DIRECTORY_PREFIX)
    try {
      this.assertBackingDirectoryPath(directory)
      await chmod(directory, 0o700)
      const metadata = await lstat(directory)
      const owner = process.getuid?.()
      const privateDirectory = metadata.isDirectory()
        && !metadata.isSymbolicLink()
        && (metadata.mode & 0o077) === 0
        && (owner === undefined || metadata.uid === owner)
      if (!privateDirectory) throw new Error('local-container-runtime: private backing directory is not an owner-only real directory')
      return directory
    } catch (error) {
      try {
        await this.removeBackingDirectory(directory)
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'local-container-runtime: backing directory setup and rollback failed')
      }
      throw error
    }
  }

  /** Remove owned resources in dependency order and preserve every failure. */
  private async cleanupOwnedResources(): Promise<void> {
    if (this.cleanup !== undefined) return this.cleanup
    const cleanup = this.cleanupResources()
    this.cleanup = cleanup
    try {
      await cleanup
    } finally {
      if (this.cleanup === cleanup) this.cleanup = undefined
    }
  }

  private async cleanupResources(): Promise<void> {
    const failures: unknown[] = []
    const processes = [...this.processes]
    const processResults = await Promise.allSettled(processes.map(async (process) => { await process.terminate() }))
    for (const result of processResults) {
      if (result.status === 'rejected') failures.push(result.reason)
    }
    if (this.processes.size > 0) {
      failures.push(new Error('local-container-runtime: process containers remain after teardown'))
    }
    if (this.container !== undefined && !this.cleanupState.containerRemoved && this.processes.size === 0) {
      let stopFailure: unknown
      try {
        await this.container.stop(this.config.stopTimeoutSeconds)
      } catch (error) {
        stopFailure = error
      }
      try {
        await this.container.remove(true)
        this.cleanupState.containerRemoved = true
      } catch (removeFailure) {
        if (stopFailure !== undefined) failures.push(stopFailure)
        failures.push(removeFailure)
      }
    }
    if (this.backingDirectory !== undefined && !this.cleanupState.backingDirectoryRemoved
      && this.processes.size === 0 && (this.container === undefined || this.cleanupState.containerRemoved)) {
      try {
        if (this.retainedDirectory === undefined) await this.removeBackingDirectory(this.backingDirectory)
        this.cleanupState.backingDirectoryRemoved = true
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      await this.stopManagedService()
    } catch (error) {
      failures.push(error)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'local-container-runtime: cleanup failed')
  }

  /** Teardown entry for Cordis disposal and finite-lifetime expiry. */
  private async close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    const closing = this.finishClose()
    this.closing = closing
    try {
      await closing
    } finally {
      if (this.closing === closing
        && (!this.cleanupState.containerRemoved || !this.cleanupState.backingDirectoryRemoved || this.engineService !== undefined)) {
        this.closing = undefined
      }
    }
  }

  private async finishClose(): Promise<void> {
    this.disposing = true
    if (this.lifetimeTimer !== undefined) clearTimeout(this.lifetimeTimer)
    let readinessFailure: unknown
    try {
      await this.ready
    } catch (error) {
      readinessFailure = error
    }
    try {
      await this.cleanupOwnedResources()
    } catch (cleanupFailure) {
      if (readinessFailure !== undefined) {
        throw new AggregateError([readinessFailure, cleanupFailure], 'local-container-runtime: readiness and teardown failed')
      }
      throw cleanupFailure
    }
    if (readinessFailure !== undefined) throw readinessFailure instanceof Error ? readinessFailure : new Error('local-container-runtime: readiness failed', { cause: readinessFailure })
  }

  /** Arm the finite world lifetime from owner construction, including setup time. */
  private armLifetime(): void {
    this.lifetimeTimer = setTimeout(() => {
      void this.close().catch((error: unknown) => {
        this.ctx.logger.error(error)
      })
    }, this.config.lifetimeMs)
  }

  /** Refuse readiness when disposal begins during setup. */
  private throwIfDisposing(): void {
    if (this.disposing) throw new Error('local-container-runtime: disposal began during setup')
  }

  /** Remove a known owner directory without following a replaced symlink. */
  private async removeBackingDirectory(directory: string): Promise<void> {
    this.assertBackingDirectoryPath(directory)
    let metadata: Awaited<ReturnType<typeof lstat>>
    try {
      metadata = await lstat(directory)
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
    if (metadata.isSymbolicLink()) {
      await unlink(directory)
      return
    }
    if (!metadata.isDirectory()) throw new Error('local-container-runtime: backing path changed from a directory')
    await rm(directory, { recursive: true, force: false })
  }

  /** Require a child path of the literal `/tmp` parent rather than a caller path. */
  private assertBackingDirectoryPath(directory: string): void {
    const child = relative(TMP_PATH, directory)
    if (child.length === 0 || child === '..' || child.startsWith('../') || child.startsWith('..\\') || isAbsolute(child)) {
      throw new Error('local-container-runtime: backing directory must stay strictly below /tmp')
    }
  }

  /** Resolve parser-owned config into security-checked Engine values. */
  private resolveConfig(config: LocalContainerRuntimeConfig): ResolvedConfig {
    if (!isAbsolute(config.socketPath) || config.socketPath.includes('\0')) {
      throw new Error('local-container-runtime: socketPath must be an absolute Unix socket path')
    }
    if (config.manageService) {
      this.assertBackingDirectoryPath(config.socketPath)
      if (config.podmanCommand === undefined || !isAbsolute(config.podmanCommand) || config.podmanCommand.includes('\0')) {
        throw new Error('local-container-runtime: managed service requires an absolute podmanCommand')
      }
    }
    if (!DIGEST_PINNED_IMAGE.test(config.image)) {
      throw new Error('local-container-runtime: image must be pinned with an sha256 digest')
    }
    if (config.user.trim().length === 0 || ROOT_USER.test(config.user)) {
      throw new Error('local-container-runtime: user must name an explicit non-root container user')
    }
    const environment = Object.entries(config.environment).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => {
      if (!ENVIRONMENT_NAME.test(name) || !ALLOWED_ENVIRONMENT_NAMES.has(name)) {
        throw new Error(`local-container-runtime: environment name is not allowlisted: ${name}`)
      }
      if (SENSITIVE_ENVIRONMENT_NAME.test(name) || value.includes('\0') || value.includes('\n') || value.includes('\r')) {
        throw new Error(`local-container-runtime: environment entry is unsafe: ${name}`)
      }
      return `${name}=${value}`
    })
    if (environment.length === 0) throw new Error('local-container-runtime: environment must be an explicit non-empty replacement')
    return {
      socketPath: config.socketPath,
      manageService: config.manageService,
      podmanCommand: config.podmanCommand,
      serviceStartupTimeoutMs: positiveSafeInteger('serviceStartupTimeoutMs', config.serviceStartupTimeoutMs, MAX_TIMER_DELAY_MS),
      image: config.image,
      user: config.user,
      environment,
      memoryBytes: positiveSafeInteger('memoryBytes', config.memoryBytes),
      nanoCpus: positiveSafeInteger('nanoCpus', config.nanoCpus),
      pidsLimit: positiveSafeInteger('pidsLimit', config.pidsLimit),
      tmpfsBytes: positiveSafeInteger('tmpfsBytes', config.tmpfsBytes),
      engineRequestTimeoutMs: positiveSafeInteger('engineRequestTimeoutMs', config.engineRequestTimeoutMs, MAX_TIMER_DELAY_MS),
      maxLiveProcesses: positiveSafeInteger('maxLiveProcesses', config.maxLiveProcesses),
      lifetimeMs: positiveSafeInteger('lifetimeMs', config.lifetimeMs, MAX_TIMER_DELAY_MS),
      stopTimeoutSeconds: positiveSafeInteger('stopTimeoutSeconds', config.stopTimeoutSeconds),
    }
  }
}

class OwnedProcessContainer implements LocalContainerProcessHandle {
  readonly id: string
  readonly done: Promise<{ exitCode: number | null; error?: string }>
  private readonly removed = Promise.withResolvers<void>()
  private readonly observation = new AbortController()
  private terminating: Promise<void> | undefined
  private removedFlag = false

  constructor(
    private readonly container: PodmanContainer,
    readonly stream: Duplex,
    readonly tty: boolean,
    private readonly stopTimeoutSeconds: number,
    private readonly release: () => void,
  ) {
    this.id = container.id
    this.done = this.settle()
    void this.done.catch(() => undefined)
  }

  async resize(rows: number, cols: number): Promise<void> {
    positiveSafeInteger('process terminal rows', rows)
    positiveSafeInteger('process terminal columns', cols)
    if (!this.tty) throw new Error('local-container-runtime: cannot resize a non-terminal process')
    await this.container.resize(rows, cols)
  }

  async inspect(argv: readonly string[], maxOutputBytes: number): Promise<{ exitCode: number; output: string }> {
    if (argv.length === 0 || argv.some(value => value.length === 0 || value.includes('\0'))) {
      throw new Error('local-container-runtime: process inspection argv is invalid')
    }
    positiveSafeInteger('process inspection maxOutputBytes', maxOutputBytes)
    return await this.container.runControl(argv, maxOutputBytes)
  }

  async signal(signal: string): Promise<void> {
    if (!/^SIG[A-Z0-9]+$/u.test(signal)) throw new Error('local-container-runtime: invalid process signal')
    await this.container.kill(signal)
  }

  async terminate(): Promise<void> {
    if (this.removedFlag) return
    if (this.terminating !== undefined) {  await this.terminating; return }
    const operation = this.removeOwned()
    this.terminating = operation
    try {
      await operation
    } finally {
      if (this.terminating === operation) this.terminating = undefined
    }
  }

  async waitForRemoval(signal?: AbortSignal): Promise<boolean> {
    if (this.removedFlag) return true
    if (signal?.aborted === true) return false
    if (signal === undefined) {
      await this.removed.promise
      return true
    }
    return await new Promise<boolean>((resolve, reject) => {
      const aborted = (): void => { resolve(false) }
      signal.addEventListener('abort', aborted, { once: true })
      void this.removed.promise.then(() =>{  resolve(true) }, reject).finally(() => {
        signal.removeEventListener('abort', aborted)
      })
    })
  }

  private async settle(): Promise<{ exitCode: number | null; error?: string }> {
    const wait = this.container.wait(this.observation.signal)
    const drained = finished(this.stream, { writable: false })
    let outcome: { statusCode: number; error?: string } | undefined
    let failure: unknown
    try {
      ;[outcome] = await Promise.all([wait, drained])
    } catch (error) {
      failure = error
    }
    try {
      await this.terminate()
    } catch (cleanupError) {
      if (failure !== undefined) throw new AggregateError([failure, cleanupError], 'local-container-runtime: process observation and cleanup failed')
      throw cleanupError
    }
    if (failure !== undefined) throw failure instanceof Error ? failure : new Error('local-container-runtime: process observation failed', { cause: failure })
    if (outcome === undefined) throw new Error('local-container-runtime: process settled without an outcome')
    return { exitCode: outcome.statusCode, ...outcome.error === undefined ? {} : { error: outcome.error } }
  }

  private async removeOwned(): Promise<void> {
    await removeContainer(this.container, this.stopTimeoutSeconds)
    this.observation.abort()
    this.stream.destroy()
    this.removedFlag = true
    this.release()
    this.removed.resolve()
  }
}

async function removeContainer(container: PodmanContainer, stopTimeoutSeconds: number): Promise<void> {
  try {
    await container.stop(stopTimeoutSeconds)
  } catch {
    // Force removal below is the authoritative quiescence operation.
  }
  try {
    await container.remove(true)
  } catch (error) {
    if (!isMissingContainer(error)) throw error
  }
}

/** Compare a response list against one expected set without trusting order. */
function sameValues(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return actual !== undefined && actual.length === expected.length && actual.every(value => expected.includes(value))
}

/** Reject a non-finite, non-integral, zero, or oversized configuration bound. */
function positiveSafeInteger(name: string, value: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`local-container-runtime: ${name} must be a positive safe integer no greater than ${maximum}`)
  }
  return value
}

/** Identify a directory that teardown has already removed. */
function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/** Identify an Engine response proving that no named container was created. */
function isMissingContainer(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 404
}

export default LocalContainerRuntime
