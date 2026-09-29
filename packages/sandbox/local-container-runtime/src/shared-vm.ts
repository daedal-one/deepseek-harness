/** Persistent, environment-owned VM execution without conversation Git transactions. @module */
import { createHash } from 'node:crypto'
import { lstat, realpath, statfs } from 'node:fs/promises'
import { posix } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ConversationWorkspaceId } from './workspace-types.ts'
import { IncusDevelopmentVms, incusCommand, type DevelopmentVmConfig, type VmDirectoryMount } from './vm-engine.ts'
import { createVmProcess } from './vm-process.ts'
import type { ExecutionRuntime, LocalContainerProcessHandle, LocalContainerProcessRequest,
  PodmanControllerExecRequest, PodmanControllerExecResult } from './types.ts'
import { LocalContainerControllerAborted, LocalContainerControllerDeadlineExceeded } from './index.ts'

/** Operator-owned shared VM identity, directory mounts, and command bounds. */
export interface SharedVmConfig extends DevelopmentVmConfig {
  /** Stable environment identity; independent of any conversation. */
  environmentId: string
  /** Existing durable host directory mounted at /workspace. */
  workspaceDirectory: string
  /** Existing repositories shared by every admitted session. */
  repositories: VmDirectoryMount[]
  /** Complete non-secret guest command environment. */
  environment: Record<string, string>
  /** Bound on commands attached through this Harness process. */
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
 * @returns mapping in guest coordinates; unmounted absolute paths reject.
 */
export function sharedVmPaths(config: Pick<SharedVmConfig, 'workspaceDirectory' | 'repositories'>): (path: string) => string {
  const mounts = [{ source: config.workspaceDirectory, path: '/workspace' }, ...config.repositories]
  for (const [index, mount] of mounts.entries()) {
    if (!posix.isAbsolute(mount.source) || mount.source === '/' || posix.normalize(mount.source) !== mount.source
      || mount.source.includes('\0') || mount.source.endsWith('/')
      || posix.normalize(mount.path) !== mount.path || mount.path.includes('\0')
      || (index > 0 && (!mount.path.startsWith('/workspace/') || mount.path.endsWith('/')))) {
      throw new Error('shared-vm: mounts require canonical host directories and normalized workspace targets')
    }
    for (const previous of mounts.slice(0, index)) {
      if ([mount.source, previous.source].some((source, position) => {
        const other = position === 0 ? previous.source : mount.source
        return source === other || source.startsWith(`${other}/`)
      }) || (previous.path !== '/workspace' && (mount.path === previous.path
        || mount.path.startsWith(`${previous.path}/`) || previous.path.startsWith(`${mount.path}/`)))) {
        throw new Error('shared-vm: duplicate or overlapping directory mounts')
      }
    }
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
    environment: z.dict(z.string()).required(), maxLiveProcesses: z.natural().required(),
  })
  readonly executionWorld: object = Object.freeze({})
  readonly containerName: string
  private readonly id: ConversationWorkspaceId
  private readonly engine: IncusDevelopmentVms
  private readonly command: ReturnType<typeof incusCommand>
  private readonly mapPath: (path: string) => string
  private readonly opening: Promise<void>
  private readonly processes = new Set<LocalContainerProcessHandle>()
  private readonly allocating = new Set<Promise<LocalContainerProcessHandle>>()
  private closing = false

  constructor(ctx: Context, private readonly config: SharedVmConfig) {
    super(ctx, 'executionRuntime')
    this.id = sharedVmId(config.environmentId)
    this.engine = new IncusDevelopmentVms(config)
    this.containerName = this.engine.name(this.id)
    this.command = incusCommand(config)
    this.mapPath = sharedVmPaths(config)
    if (!Number.isSafeInteger(config.maxLiveProcesses) || config.maxLiveProcesses < 1) throw new Error('shared-vm: invalid command limit')
    validateEnvironment(config.environment, true)
    this.opening = this.open()
    void this.opening.catch(() => undefined)
    ctx.effect(() => async () => {
      this.closing = true
      await Promise.allSettled([this.opening])
      await Promise.allSettled(this.allocating)
      const outcomes = await Promise.allSettled([...this.processes].map(async (handle) => {
        await handle.terminate()
        if (!await handle.waitForRemoval()) throw new Error('shared-vm: command removal unconfirmed')
      }))
      const failures = outcomes.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      if (failures.length) throw new AggregateError(failures, 'shared-vm: command teardown failed; VM retained')
    }, 'shared VM command teardown')
  }

  /** Wait for mount, VM identity, network, and guest readiness verification. */
  async ensureReady(): Promise<void> { await this.opening; if (this.closing) throw new Error('shared-vm: runtime is closing') }

  /** Map a configured repository path into the shared guest.
   * @param path - host alias, guest path, or relative path.
   * @returns the path in the shared environment.
   */
  executionPath(path: string): string { return this.mapPath(path) }

  private async open(): Promise<void> {
    for (const source of [this.config.workspaceDirectory, ...this.config.repositories.map(mount => mount.source)]) {
      const [info, canonical, filesystem] = await Promise.all([lstat(source), realpath(source), statfs(source)])
      if (!info.isDirectory() || canonical !== source || filesystem.type === 0x01021994) {
        throw new Error('shared-vm: mount source must be a real disk-backed directory')
      }
    }
    await this.engine.verifyNetwork()
    if (!await this.engine.exists(this.id)) throw new Error(`shared-vm: provision ${this.containerName} before starting this profile`)
    await this.engine.verify(this.id, this.config.workspaceDirectory, this.config.repositories)
    if (this.closing) throw new Error('shared-vm: runtime is closing')
    const state = await this.engine.state(this.id)
    if (state === 'Stopped') await this.engine.start(this.id)
    else if (state !== 'Running') throw new Error(`shared-vm: instance is ${state}; operator action required`)
    await this.command(['exec', this.containerName, '--project', this.config.project, '--', '/usr/bin/mountpoint', '-q', '/workspace'])
    for (const mount of this.config.repositories) {
      await this.command(['exec', this.containerName, '--project', this.config.project, '--', '/usr/bin/mountpoint', '-q', mount.path])
    }
  }

  /** Allocate one independently cancellable guest command.
   * @param request - command and standard streams in guest coordinates.
   * @returns the owned systemd command handle; never owns the VM lifetime.
   */
  async createProcess(request: LocalContainerProcessRequest): Promise<LocalContainerProcessHandle> {
    await this.ensureReady()
    if (this.processes.size + this.allocating.size >= this.config.maxLiveProcesses) throw new Error('shared-vm: attached command limit reached')
    request.signal?.throwIfAborted()
    const environment = { ...this.config.environment, ...request.environment }
    validateEnvironment(environment, false)
    const cwd = this.mapPath(request.cwd)
    if (cwd !== '/workspace' && (!cwd.startsWith('/workspace/') || posix.normalize(cwd) !== cwd)) throw new Error('shared-vm: command directory is outside workspace')
    const operation = createVmProcess(this.config, this.containerName, { ...request, cwd: cwd as LocalContainerProcessRequest['cwd'], environment }, this.command)
    this.allocating.add(operation)
    try {
      const handle = await operation
      this.processes.add(handle)
      void handle.done.finally(() => this.processes.delete(handle)).catch(() => undefined)
      if (this.closing) { await handle.terminate(); throw new Error('shared-vm: runtime is closing') }
      return handle
    } finally { this.allocating.delete(operation) }
  }

  /** Run a bounded filesystem/tool controller without stopping other guest work.
   * @param request - command, input, output bound, deadline, and cancellation.
   * @returns complete bounded output and the command exit status.
   */
  async executeController(request: PodmanControllerExecRequest & { readonly deadlineMs: number }): Promise<PodmanControllerExecResult> {
    if (!Number.isSafeInteger(request.deadlineMs) || request.deadlineMs < 1 || request.deadlineMs > 2_147_483_647
      || !Number.isSafeInteger(request.maxOutputBytes) || request.maxOutputBytes < 1) throw new Error('shared-vm: invalid controller bounds')
    const cancel = new AbortController()
    const timer = setTimeout(() => { cancel.abort(new Error('shared-vm: controller deadline exceeded')) }, request.deadlineMs)
    const signal = request.signal === undefined ? cancel.signal : AbortSignal.any([cancel.signal, request.signal])
    let handle: LocalContainerProcessHandle | undefined
    try {
      handle = await this.createProcess({ argv: request.argv as [string, ...string[]], cwd: '/workspace', environment: {}, tty: false, stdin: true, signal })
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
