/** Persistent, environment-owned VM execution without conversation Git transactions. @module */
import { createHash } from 'node:crypto'
import { lstat, realpath, statfs } from 'node:fs/promises'
import { posix } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkspacePreparationKind } from '@deepseek-ai/dsh-workspace'
import type { ConversationWorkspaceId } from './workspace-types.ts'
import { IncusDevelopmentVms, incusCommand, type DevelopmentVmConfig, type VmDirectoryMount } from './vm-engine.ts'
import { createVmProcess, VmProcessCleanupUnconfirmed } from './vm-process.ts'
import { sharedGitAuthorization } from './shared-git.ts'
import { SharedVmSelection, type WorkspaceSelectionConfig } from './shared-vm-selection.ts'
import { SharedVmExports, type SharedVmExportsConfig } from './shared-vm-exports.ts'
import { SharedVmAdmission } from './shared-vm-admission.ts'
import { WorkspaceAdmission } from './workspace-admission.ts'
import type { ExecutionRuntime, LocalContainerProcessHandle, LocalContainerProcessRequest,
  PodmanControllerExecRequest, PodmanControllerExecResult, WorkspaceGitRemote } from './types.ts'
import { LocalContainerControllerAborted, LocalContainerControllerDeadlineExceeded } from './index.ts'

/** Operator-owned shared VM identity, directory mounts, and command bounds. */
export interface SharedVmConfig extends DevelopmentVmConfig {
  /** Stable environment identity; independent of any conversation. */
  environmentId: string
  /** Existing durable host directory mounted at /workspace. */
  workspaceDirectory: string
  /** Existing repositories shared by every admitted session. */
  repositories: VmDirectoryMount[]
  /** Optional exact-directory attachment for Workspace selections under operator-approved roots. */
  workspaceSelection?: WorkspaceSelectionConfig
  /** Optional scalable exact-directory selection through one operator-owned catalogue. */
  directoryExports?: SharedVmExportsConfig
  /** Optional operator-approved Git access for exact mounted repository sources. */
  gitRemotes?: WorkspaceGitRemote[]
  /** Complete non-secret guest command environment. */
  environment: Record<string, string>
  /** Optional bound on admitted root conversations; children share their parent reservation. */
  maxActiveConversations?: number
  /** Bound on commands attached through this Harness process; excess commands wait in FIFO order. */
  maxLiveProcesses: number
}

/** Derive the retained VM identity from the deployment's environment identifier.
 * @param environmentId - stable operator-configured identity.
 * @returns the deterministic instance suffix used by the existing Incus manager.
 */
export function sharedVmId(environmentId: string): ConversationWorkspaceId {
  if (!/^[a-z][a-z0-9-]{0,62}$/u.test(environmentId)) throw new Error('shared-vm: invalid environment identity')
  return brandString<ConversationWorkspaceId>(createHash('sha256').update(`shared-environment:${environmentId}`).digest('hex').slice(0, 32))
}

/** Validate and map explicitly mounted host paths without reading repository contents.
 * @param config - deployment-owned workspace and repository mounts.
 * @param aliases - selected directories exposed inside a declared catalogue device.
 * @returns mapping in guest coordinates; unmounted absolute paths reject.
 */
export function sharedVmPaths(
  config: Pick<SharedVmConfig, 'workspaceDirectory' | 'repositories'>,
  aliases: readonly VmDirectoryMount[] = [],
): (path: string) => string {
  const native = [{ source: config.workspaceDirectory, path: '/workspace' }, ...config.repositories]
  const mounts = [...native, ...aliases]
  const sources = new Set<string>(); const targets = new Set<string>()
  for (const [index, mount] of mounts.entries()) {
    if (!posix.isAbsolute(mount.source) || mount.source === '/' || posix.normalize(mount.source) !== mount.source
      || mount.source.includes('\0') || mount.source.endsWith('/')
      || posix.normalize(mount.path) !== mount.path || mount.path.includes('\0')
      || (index > 0 && (!mount.path.startsWith('/workspace/') || mount.path.endsWith('/')))) {
      throw new Error('shared-vm: mounts require canonical host directories and normalized workspace targets')
    }
    if (sources.has(mount.source) || targets.has(mount.path)) throw new Error('shared-vm: duplicate or overlapping directory mounts')
    sources.add(mount.source); targets.add(mount.path)
  }
  const nativeTargets = new Set(native.slice(1).map(mount => mount.path))
  const aliasTargets = new Set(aliases.map(mount => mount.path))
  for (const mount of mounts) {
    for (let parent = posix.dirname(mount.source); parent !== '/'; parent = posix.dirname(parent)) {
      if (sources.has(parent)) throw new Error('shared-vm: duplicate or overlapping directory mounts')
    }
    let exported = false
    for (let parent = posix.dirname(mount.path); parent !== '/'; parent = posix.dirname(parent)) {
      if (nativeTargets.has(parent)) {
        if (!aliasTargets.has(mount.path)) throw new Error('shared-vm: duplicate or overlapping directory mounts')
        exported = true
      }
      if (aliasTargets.has(parent)) throw new Error('shared-vm: duplicate or overlapping directory mounts')
    }
    if (aliasTargets.has(mount.path) && !exported) throw new Error('shared-vm: selected aliases require a configured catalogue mount')
  }
  return (path) => {
    if (path.includes('\0')) throw new Error('shared-vm: invalid path')
    if (!posix.isAbsolute(path)) return path
    const normalized = posix.normalize(path)
    if (normalized === '/workspace' || normalized.startsWith('/workspace/')) return normalized
    const mount = mounts.find(value => normalized === value.source || normalized.startsWith(`${value.source}/`))
    if (mount === undefined) throw new Error('shared-vm: path is not in a configured workspace mount')
    return posix.join(mount.path, posix.relative(mount.source, normalized))
  }
}

/** Attach to a pre-provisioned persistent VM; disposal releases commands, never the VM or files. */
export class SharedVmRuntime extends Service implements ExecutionRuntime {
  static Config: z<SharedVmConfig> = z.object({
    command: z.string().required(), pythonCommand: z.string().required(), devicesRoot: z.string().required(),
    project: z.string().required(), storage: z.string().required(), network: z.string().required(), acl: z.string().required(),
    hostAddresses: z.array(z.string()).required(), image: z.string().required(),
    workspaceUid: z.natural().required(), workspaceGid: z.natural().required(), maxInstances: z.natural().required(),
    cpus: z.natural().required(), memoryBytes: z.natural().required(), diskBytes: z.natural().required(),
    timeoutMs: z.natural().required(), readinessPollMs: z.natural().required(), maxOutputBytes: z.natural().required(),
    environmentId: z.string().required(), workspaceDirectory: z.string().required(),
    repositories: z.array(z.object({ source: z.string().required(), path: z.string().required() })).required(),
    directoryExports: z.object({ command: z.string().required(), args: z.array(z.string()).required(),
      source: z.string().required(), path: z.string().required(), directory: z.string().required(),
      timeoutMs: z.natural().required(), maxOutputBytes: z.natural().required() }).default(undefined as never),
    workspaceSelection: z.object({ roots: z.array(z.string()).required(), directory: z.string().required(),
      maxMounts: z.natural().required(), maxStateBytes: z.natural().required() }).default(undefined as never),
    gitRemotes: z.array(z.object({ source: z.string().required(), url: z.string().required(),
      credentialCommand: z.string().required(), credentialTimeoutMs: z.natural().required() })).default(undefined as never),
    environment: z.dict(z.string()).required(), maxLiveProcesses: z.natural().required(),
    maxActiveConversations: z.natural().default(undefined as never),
  })
  readonly executionWorld: object = Object.freeze({})
  readonly containerName: string
  private readonly id: ConversationWorkspaceId
  private readonly engine: IncusDevelopmentVms
  private readonly command: ReturnType<typeof incusCommand>
  private mapPath: (path: string) => string
  private readonly selection?: SharedVmSelection
  private readonly exports?: SharedVmExports
  private selecting: Promise<void> = Promise.resolve()
  private readonly opening: Promise<void>
  private readonly authorize: () => Promise<string[]>
  private readonly processes = new Set<LocalContainerProcessHandle>()
  private readonly allocating = new Set<Promise<LocalContainerProcessHandle>>()
  private closing = false
  private readonly commandAdmission: WorkspaceAdmission
  private readonly turnAdmission?: SharedVmAdmission
  private readonly lifetime = new AbortController()
  private readonly settling = new Set<Promise<void>>()
  private readonly uncertain = new Set<VmProcessCleanupUnconfirmed>()

  constructor(ctx: Context, private readonly config: SharedVmConfig) {
    super(ctx, 'executionRuntime')
    this.id = sharedVmId(config.environmentId)
    this.engine = new IncusDevelopmentVms(config)
    this.containerName = this.engine.name(this.id)
    this.command = incusCommand(config)
    this.mapPath = sharedVmPaths(config)
    if (config.workspaceSelection !== undefined && config.directoryExports !== undefined) throw new Error('shared-vm: configure one Workspace selection provider')
    if (config.directoryExports !== undefined) {
      this.exports = new SharedVmExports(config.directoryExports, config.environmentId, config.repositories,
        config.workspaceDirectory, async mount => this.verifyExport(mount.path))
    }
    if (config.workspaceSelection !== undefined) {
      this.selection = new SharedVmSelection(config.workspaceSelection, config.environmentId, config.repositories, {
        validate: (repositories) => { sharedVmPaths({ ...config, repositories }) },
        verify: repositories => this.engine.verify(this.id, config.workspaceDirectory, repositories),
        attach: async (mount, index) => {
          if (this.closing) throw new Error('shared-vm: runtime is closing')
          await this.command(['config', 'device', 'add', this.containerName, `repository-${index}`, 'disk',
            `source=${mount.source}`, `path=${mount.path}`, '--project', config.project])
        },
        ready: async (mount) => {
          await this.startVerifiedVm()
          const deadline = Date.now() + config.timeoutMs
          for (;;) {
            try { await this.verifyMount(mount.path); return }
            catch (error) { if (Date.now() >= deadline || this.closing) throw error }
            await new Promise(resolve => setTimeout(resolve, config.readinessPollMs))
          }
        },
      }, config.workspaceDirectory)
    }
    this.authorize = sharedGitAuthorization(config.repositories, config.gitRemotes ?? [])
    if (!Number.isSafeInteger(config.maxLiveProcesses) || config.maxLiveProcesses < 1) throw new Error('shared-vm: invalid command limit')
    this.commandAdmission = new WorkspaceAdmission(config.maxLiveProcesses)
    if (config.maxActiveConversations !== undefined) this.turnAdmission = new SharedVmAdmission(ctx, config.maxActiveConversations)
    validateEnvironment(config.environment, true)
    this.opening = this.open()
    void this.opening.catch(() => undefined)
    ctx.on('workspace/prepare', (path, kind) => this.prepareWorkspace(path, kind))
    ctx.on('agent/prepare', async ({ agent }) => {
      await this.ensureReady()
      try {
        const cwd = this.executionPath(agent.session.header.cwd ?? '/workspace')
        if (cwd !== '/workspace' && !cwd.startsWith('/workspace/')) throw new Error('Agent cwd must be inside the guest workspace')
      }
      catch (error) { throw new Error('shared-vm: select this workspace in the application before starting its Agent', { cause: error }) }
    })
    ctx.effect(() => async () => {
      this.closing = true
      this.lifetime.abort(new Error('shared-vm: runtime is closing'))
      await this.turnAdmission?.close()
      await Promise.allSettled([this.opening])
      await Promise.allSettled([this.selecting])
      await Promise.allSettled(this.allocating)
      const outcomes = await Promise.allSettled([...this.processes].map(async (handle) => {
        await handle.terminate()
        if (!await handle.waitForRemoval()) throw new Error('shared-vm: command removal unconfirmed')
      }))
      await Promise.allSettled(this.settling)
      const failures = outcomes.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      failures.push(...this.uncertain)
      await this.selection?.close()
      await this.exports?.close()
      if (failures.length) throw new AggregateError(failures, 'shared-vm: command teardown failed; VM retained')
    }, 'shared VM command teardown')
  }

  /** Wait for mount, VM identity, network, and guest readiness verification. */
  async ensureReady(): Promise<void> {
    await this.opening
    this.lifetime.signal.throwIfAborted()
    await this.exports?.ensureCurrent()
    this.lifetime.signal.throwIfAborted()
  }

  /** Map a configured repository path into the shared guest.
   * @param path - host alias, guest path, or relative path.
   * @returns the path in the shared environment.
   */
  executionPath(path: string): string { return this.mapPath(path) }

  private prepareWorkspace(path: string, kind: WorkspacePreparationKind): Promise<void> {
    const operation = this.selecting.then(async () => {
      await this.ensureReady()
      if (!posix.isAbsolute(path)) throw new Error('shared-vm: select a fully qualified workspace directory')
      const hostSources = [this.config.workspaceDirectory, ...this.config.repositories.map(mount => mount.source),
        ...this.selection?.mounts.map(mount => mount.source) ?? [],
        ...this.exports?.mounts.map(mount => mount.source) ?? []]
      const guestAlias = kind === 'session' && (path === '/workspace' || path.startsWith('/workspace/'))
      if (guestAlias || hostSources.some(source => path === source || path.startsWith(`${source}/`))) {
        this.mapPath(path)
        return
      }
      if (this.selection === undefined && this.exports === undefined) throw new Error('shared-vm: this directory is not mounted; ask the operator to configure directoryExports, workspaceSelection, or an exact repository mount')
      try {
        if (this.exports !== undefined) await this.exports.select(path)
        else if (this.selection !== undefined) await this.selection.select(path)
      }
      finally { this.refreshPaths() }
      if (this.closing) throw new Error('shared-vm: runtime is closing')
    })
    this.selecting = operation.then(() => undefined, () => undefined)
    return operation
  }

  private refreshPaths(): void {
    const repositories = [...this.config.repositories, ...this.selection?.mounts ?? []]
    this.mapPath = sharedVmPaths({ ...this.config, repositories }, this.exports?.mounts)
  }

  private async open(): Promise<void> {
    await this.selection?.open()
    await this.exports?.open()
    for (const source of [this.config.workspaceDirectory, ...this.config.repositories.map(mount => mount.source)]) {
      const [info, canonical, filesystem] = await Promise.all([lstat(source), realpath(source), statfs(source)])
      if (!info.isDirectory() || canonical !== source || filesystem.type === 0x01021994) {
        throw new Error('shared-vm: mount source must be a real disk-backed directory')
      }
    }
    await this.engine.verifyNetwork()
    if (!await this.engine.exists(this.id)) throw new Error(`shared-vm: provision ${this.containerName} before starting this profile`)
    await this.selection?.recover()
    const repositories = [...this.config.repositories, ...this.selection?.mounts ?? []]
    await this.engine.verify(this.id, this.config.workspaceDirectory, repositories)
    if (this.closing) throw new Error('shared-vm: runtime is closing')
    await this.startVerifiedVm()
    this.refreshPaths()
    await this.verifyMount('/workspace')
    for (const mount of repositories) await this.verifyMount(mount.path)
    await this.exports?.verify()
  }

  private async startVerifiedVm(): Promise<void> {
    const state = await this.engine.state(this.id)
    if (state === 'Stopped') await this.engine.start(this.id, async () => { await this.exports?.restore() })
    else if (state === 'Running') await this.exports?.restore()
    else throw new Error(`shared-vm: instance is ${state}; operator action required`)
  }

  private async verifyMount(path: string): Promise<void> {
    await this.command(['exec', this.containerName, '--project', this.config.project, '--', '/usr/bin/mountpoint', '-q', path])
  }

  private async verifyExport(path: string): Promise<void> {
    const deadline = Date.now() + this.config.timeoutMs
    for (;;) {
      try {
        await this.command(['exec', this.containerName, '--project', this.config.project, '--', '/usr/bin/python3', '-c',
          'import os,sys; fd=os.open(sys.argv[1],os.O_RDONLY|os.O_DIRECTORY); os.close(fd)', path])
        return
      } catch (error) { if (Date.now() >= deadline || this.closing) throw error }
      await new Promise(resolve => setTimeout(resolve, this.config.readinessPollMs))
    }
  }

  /** Allocate one independently cancellable guest command.
   * @param request - command and standard streams in guest coordinates.
   * @returns the owned systemd command handle; never owns the VM lifetime.
   */
  async createProcess(request: LocalContainerProcessRequest): Promise<LocalContainerProcessHandle> {
    return await this.allocate(request, true)
  }

  private async allocate(request: LocalContainerProcessRequest, git: boolean): Promise<LocalContainerProcessHandle> {
    await this.ensureReady()
    const signal = request.signal === undefined ? this.lifetime.signal : AbortSignal.any([request.signal, this.lifetime.signal])
    signal.throwIfAborted()
    const environment = { ...this.config.environment, ...request.environment }
    validateEnvironment(environment, false)
    const cwd = this.mapPath(request.cwd)
    const operation = (async () => {
      const release = await this.commandAdmission.acquire(signal)
      let owned = false
      try {
        signal.throwIfAborted()
        const authorization = git ? await this.authorize() : []
        signal.throwIfAborted()
        const handle = await createVmProcess(this.config, this.containerName,
          { ...request, signal, cwd: cwd as LocalContainerProcessRequest['cwd'], environment }, this.command, authorization)
        owned = true
        this.processes.add(handle)
        const settle = async (): Promise<void> => {
          if (!await handle.waitForRemoval()) throw new Error('shared-vm: command cleanup unconfirmed; capacity retained')
          this.processes.delete(handle)
          release()
        }
        const settlement = handle.done.then(settle, settle)
        this.settling.add(settlement)
        void settlement.finally(() => this.settling.delete(settlement)).catch((error: unknown) => { this.ctx.logger.error(error) })
        if (this.closing) { await handle.terminate(); throw new Error('shared-vm: runtime is closing') }
        return handle
      } catch (error) {
        if (error instanceof VmProcessCleanupUnconfirmed) { owned = true; this.uncertain.add(error) }
        throw error
      } finally { if (!owned) release() }
    })()
    this.allocating.add(operation)
    try { return await operation }
    finally { this.allocating.delete(operation) }
  }

  /** Run a bounded filesystem/tool controller without stopping other guest work.
   * @param request - command, input, output bound, deadline, and cancellation.
   * @returns complete bounded output and the command exit status.
   */
  async executeController(request: PodmanControllerExecRequest & { readonly deadlineMs: number }): Promise<PodmanControllerExecResult> {
    if (!Number.isSafeInteger(request.deadlineMs) || request.deadlineMs < 1 || request.deadlineMs > 2_147_483_647
      || !Number.isSafeInteger(request.maxOutputBytes) || request.maxOutputBytes < 1) throw new Error('shared-vm: invalid controller bounds')
    const cancel = new AbortController()
    let timer: NodeJS.Timeout | undefined
    const signal = request.signal === undefined ? cancel.signal : AbortSignal.any([cancel.signal, request.signal])
    let handle: LocalContainerProcessHandle | undefined
    try {
      handle = await this.allocate({ argv: request.argv as [string, ...string[]], cwd: '/workspace', environment: {}, tty: false, stdin: true, signal }, false)
      timer = setTimeout(() => { cancel.abort(new Error('shared-vm: controller deadline exceeded')) }, request.deadlineMs)
      handle.stream.end(request.stdin)
      const stdout: Buffer[] = []; const stderr: Buffer[] = []
      let pending = Buffer.alloc(0); let size = 0
      for await (const raw of handle.stream) {
        pending = Buffer.concat([pending, Buffer.from(raw as Uint8Array)])
        while (pending.length >= 8) {
          const length = pending.readUInt32BE(4)
          if (length > request.maxOutputBytes - size) throw new Error('shared-vm: controller output limit exceeded')
          if (pending.length < 8 + length) break
          const channel = pending[0]
          if ((channel !== 1 && channel !== 2) || pending[1] !== 0 || pending[2] !== 0 || pending[3] !== 0) throw new Error('shared-vm: invalid controller frame')
          ;(channel === 1 ? stdout : stderr).push(pending.subarray(8, 8 + length))
          size += length; pending = pending.subarray(8 + length)
        }
      }
      const result = await handle.done
      signal.throwIfAborted()
      if (pending.length !== 0 || result.error !== undefined || result.exitCode === null) throw new Error('shared-vm: controller failed or stream incomplete')
      return { exitCode: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }
    } catch (error) {
      if (handle !== undefined) {
        try { await handle.terminate() }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'shared-vm: controller cleanup unconfirmed') }
      }
      if (cancel.signal.aborted) throw new LocalContainerControllerDeadlineExceeded()
      if (request.signal?.aborted) throw new LocalContainerControllerAborted()
      throw error
    } finally { clearTimeout(timer) }
  }
}

function validateEnvironment(environment: Readonly<Record<string, string | undefined>>, configuration: boolean): void {
  for (const [key, value] of Object.entries(environment)) {
    if (!/^[A-Z_][A-Z0-9_]*$/u.test(key) || (configuration && /KEY|SECRET|TOKEN|PASSWORD/iu.test(key))
      || (value !== undefined && /[\0\r\n]/u.test(value))) throw new Error('shared-vm: invalid or secret command environment')
  }
}

export default SharedVmRuntime
